document.addEventListener('DOMContentLoaded', () => {
    // --- Get all the UI elements ---
    const qrCodeContainer = document.getElementById('qrcode-container');
    const qrWrapper = document.querySelector('.qr-wrapper');
    const h1 = document.querySelector('h1');
    const scanText = document.getElementById('scan-text');
    const statusText = document.getElementById('status-text');
    const receivingFilesList = document.getElementById('receiving-files-list');
    const reloadIcon = document.getElementById('reload-icon');
    const saveButton = document.getElementById('save-button'); // <-- Your "Save All" button

    // --- IMPORTANT: Double-check your computer's current IP address ---
    const ipAddress = '192.168.0.4'; // UPDATE THIS IF IT CHANGES
    
    const localServerUrl = `http://${ipAddress}:8081`;
    const signalingServerUrl = `ws://${ipAddress}:8080`;

    // --- ALL LOGIC IS NOW LOCAL ---
    const sessionId = crypto.randomUUID();
    const mobileUrl = `${localServerUrl}?sessionId=${sessionId}`;

    let peerConnection;
    let dataChannel;
    let isConnected = false;
    const fileStates = {}; // status: 'receiving' | 'complete' | 'zipped'

    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    };

    // --- QR CODE GENERATION (WILL WORK NOW) ---
    try {
        new QRCode(qrCodeContainer, {
            text: mobileUrl,
            width: 120,
            height: 120,
        });
        console.log('POPUP: QR Code generated for session:', sessionId);
    } catch (e) {
        h1.textContent = 'ERROR';
        scanText.textContent = 'Could not generate QR Code.';
        statusText.textContent = 'Please reload the extension.';
        return;
    }
    
    // --- WEBSOCKET & WEBRTC LOGIC ---
    const ws = new WebSocket(signalingServerUrl);
    
    ws.onopen = () => {
        console.log('POPUP: Connected to signaling server.');
        ws.send(JSON.stringify({ type: 'join', sessionId }));
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'peer-joined') {
            createPeerConnectionAndOffer();
        } else if (data.type === 'answer') {
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        } else if (data.type === 'candidate') {
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        }
    };

    function createPeerConnectionAndOffer() {
        peerConnection = new RTCPeerConnection(configuration);
        dataChannel = peerConnection.createDataChannel("fileChannel");
        
        dataChannel.onmessage = (event) => {
            try {
                const metadata = JSON.parse(event.data);
                if (metadata.type === 'metadata') {
                    const fileName = metadata.name;
                    fileStates[fileName] = {
                        metadata: metadata,
                        chunks: [],
                        receivedSize: 0,
                        status: 'receiving',
                        progress: 0,
                        blob: null // Will store the final blob here
                    };
                    updateUI(); 
                }
            } catch (e) {
                const chunk = event.data;
                const activeFileKey = Object.keys(fileStates).find(key => 
                    fileStates[key].status === 'receiving'
                );

                if (activeFileKey) {
                    const fileState = fileStates[activeFileKey];
                    fileState.chunks.push(chunk);
                    fileState.receivedSize += chunk.byteLength;
                    fileState.progress = Math.round((fileState.receivedSize / fileState.metadata.size) * 100);

                    if (fileState.receivedSize >= fileState.metadata.size) {
                        // --- THIS IS THE FIX ---
                        // Store the raw blob directly. Do not create a URL.
                        fileState.blob = new Blob(fileState.chunks); 
                        fileState.status = 'complete'; 
                        fileState.chunks = []; // Clear chunks from memory
                    }
                    updateUI(); 
                }
            }
        };

        peerConnection.onicecandidate = (event) => {
             if (event.candidate) {
                ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, sessionId }));
            }
        };

        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            console.log(`POPUP: Connection state changed to ${state}`);
            
            if (state === 'connected') {
                isConnected = true;
                scanText.textContent = 'Ready to receive files from your phone.';
            } else if (state === 'disconnected' || state === 'failed') {
                isConnected = false;
                scanText.textContent = 'Scan this code with your phone camera';
                Object.keys(fileStates).forEach(key => delete fileStates[key]);
            }
            updateUI(); 
        };

        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                ws.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription, sessionId }));
            });
    }

    // --- UI Rendering Function (Matches your screenshot) ---
    function updateUI() {
        receivingFilesList.innerHTML = '';

        let isReceiving = false;
        let hasFiles = Object.keys(fileStates).length > 0;
        
        for (const fileName in fileStates) {
            const file = fileStates[fileName];
            const item = document.createElement('div');
            item.className = 'file-item';
            
            if (file.status === 'receiving') {
                isReceiving = true;
                item.innerHTML = `
                    <span class="file-name">${fileName}</span>
                    <span class="file-status">${file.progress}%</span>
                `;
                receivingFilesList.appendChild(item);
            } 
            else if (file.status === 'complete' || file.status === 'zipped') {
                // Show 100% for completed files (as requested)
                item.innerHTML = `
                    <span class="file-name">${fileName}</span>
                    <span class="file-status">100%</span>
                `;
                receivingFilesList.appendChild(item);
            }
        }
        
        if (isReceiving) {
            // --- STATE 2: RECEIVING ---
            scanText.style.display = 'none';
            receivingFilesList.style.display = 'block';
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.add('blurred');
            reloadIcon.style.display = 'block'; 
            
            // Show Save button, but disabled
            statusText.style.display = 'none';
            saveButton.style.display = 'block';
            saveButton.disabled = true;
            saveButton.textContent = 'Receiving...';

        } else if (hasFiles) {
             // --- STATE 3: RECEIVED (Ready to Download) ---
            scanText.style.display = 'none';
            receivingFilesList.style.display = 'block'; // Show the 100% files
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.add('blurred'); 
            reloadIcon.style.display = 'block'; 
            
            // Show Save button, AND ENABLE IT
            statusText.style.display = 'none';
            saveButton.style.display = 'block';
            saveButton.disabled = false;
            saveButton.textContent = 'Save All Files';

        } else if (isConnected) {
            // --- STATE 1: CONNECTED ---
            scanText.style.display = 'block';
            receivingFilesList.style.display = 'none';
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.add('blurred'); 
            reloadIcon.style.display = 'block'; 
            
            statusText.style.display = 'block';
            statusText.innerHTML = `<span>Connected</span><img src="icons/green_checkmark.png" alt="Connected" class="status-icon">`;
            saveButton.style.display = 'none';

        } else {
            // --- LAUNCH SCREEN ---
            scanText.style.display = 'block';
            receivingFilesList.style.display = 'none';
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.remove('blurred'); 
            reloadIcon.style.display = 'none'; 
            
            statusText.style.display = 'block';
            statusText.innerHTML = `<span>Waiting to connect...</span>`;
            saveButton.style.display = 'none';
        }
    }

    // --- NEW: Click listener for the Save button (Bug Fixed) ---
    saveButton.addEventListener('click', async () => {
        console.log('POPUP: Save All clicked.');
        saveButton.disabled = true;
        saveButton.textContent = 'Zipping files...';

        try {
            // JSZip is loaded from popup.html
            const zip = new JSZip();
            let fileCount = 0;

            for (const fileName in fileStates) {
                const fileState = fileStates[fileName];
                // --- THIS IS THE FIX ---
                // We are reading the raw blob, which is allowed.
                if (fileState.status === 'complete' && fileState.blob) {
                    zip.file(fileName, fileState.blob);
                    fileState.status = 'zipped'; // Mark as zipped
                    fileCount++;
                }
            }

            if (fileCount > 0) {
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const zipUrl = URL.createObjectURL(zipBlob);
                
                const link = document.createElement('a');
                link.href = zipUrl;
                link.download = `RocketShare_Files.zip`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(zipUrl);

                // Reload the popup to reset the session
                window.location.reload();
            } else {
                console.error("No files found to zip.");
                saveButton.textContent = 'Error - No files';
            }
            
        } catch (err) {
            console.error("Error zipping files:", err);
            saveButton.textContent = 'Error';
            saveButton.disabled = false;
        }
    });

    // Click listener for reload icon
    reloadIcon.addEventListener('click', () => {
        window.location.reload(); // Simple reload for the popup
    });

    // Initial UI render on load
    updateUI();
});

