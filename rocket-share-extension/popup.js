document.addEventListener('DOMContentLoaded', () => {
    // --- Get all the UI elements ---
    const qrCodeContainer = document.getElementById('qrcode-container');
    const qrWrapper = document.querySelector('.qr-wrapper');
    const h1 = document.querySelector('h1');
    const scanText = document.getElementById('scan-text');
    const statusText = document.getElementById('status-text');
    const receivingFilesList = document.getElementById('receiving-files-list');
    const downloadArea = document.getElementById('download-area');
    const reloadIcon = document.getElementById('reload-icon');

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
    const fileStates = {}; // status: 'receiving' | 'complete' | 'downloaded'

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
    
    // --- WEBSOCKET & WEBRTC LOGIC (MOVED FROM SERVICE WORKER) ---
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
                        url: null // Will store the final ObjectURL here
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
                        const fileBlob = new Blob(fileState.chunks);
                        fileState.status = 'complete'; 
                        fileState.url = URL.createObjectURL(fileBlob); // Create and store the URL
                        fileState.chunks = []; 
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

    // --- UI Rendering Function ---
    function updateUI() {
        receivingFilesList.innerHTML = '';
        downloadArea.innerHTML = ''; // Clear both lists

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
            else if (file.status === 'complete') {
                item.innerHTML = `
                    <span class="file-name">${fileName}</span>
                    <a class="download-link" data-filename="${fileName}" href="${file.url}" download="${fileName}">
                        <img src="icons/download_icon.png" alt="Download" class="downloaded-icon">
                    </a>
                `;
                downloadArea.appendChild(item); // Add to the download list
            }
            else if (file.status === 'downloaded') {
                item.innerHTML = `
                    <span class="file-name">${fileName}</span>
                    <span class="file-status"><img src="icons/green_checkmark.png" alt="Downloaded" class="downloaded-icon"></span>
                `;
                downloadArea.appendChild(item); // Add to the download list
            }
        }
        
        // --- Update main status text and visibility based on what's happening ---
        if (isReceiving) {
            // --- STATE 2: RECEIVING ---
            scanText.style.display = 'none';
            receivingFilesList.style.display = 'block';
            downloadArea.style.display = 'block'; // Show completed files too
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.add('blurred');
            reloadIcon.style.display = 'block'; 
            statusText.innerHTML = `<span>Receiving files...</span> <img src="icons/loader_icon.png" alt="Receiving" class="status-icon">`;
        } else if (hasFiles) {
             // --- STATE 3: RECEIVED ---
            scanText.style.display = 'none';
            receivingFilesList.style.display = 'none'; // Hide receiving list
            downloadArea.style.display = 'block'; // Show download list
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.add('blurred'); 
            reloadIcon.style.display = 'block'; 
            statusText.innerHTML = `<span>Received</span><img src="icons/green_checkmark.png" alt="Received" class="status-icon">`;
        } else if (isConnected) {
            // --- STATE 1: CONNECTED ---
            scanText.style.display = 'block';
            receivingFilesList.style.display = 'none';
            downloadArea.style.display = 'none';
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.add('blurred'); 
            reloadIcon.style.display = 'block'; 
            statusText.innerHTML = `<span>Connected</span><img src="icons/green_checkmark.png" alt="Connected" class="status-icon">`;
        } else {
            // --- LAUNCH SCREEN ---
            scanText.style.display = 'block';
            receivingFilesList.style.display = 'none';
            downloadArea.style.display = 'none';
            qrWrapper.style.display = 'block'; 
            qrCodeContainer.classList.remove('blurred'); 
            reloadIcon.style.display = 'none'; 
            statusText.innerHTML = `<span>Waiting to connect...</span>`;
        }
    }

    // --- Click Listeners ---
    downloadArea.addEventListener('click', (event) => {
        const targetLink = event.target.closest('.download-link');
        if (targetLink) {
            // NOTE: We don't preventDefault() here, so the link click works
            const fileName = targetLink.dataset.filename;
            const fileState = fileStates[fileName];
            
            if (fileState && fileState.url) {
                // We must update the state *after* the click has been processed
                setTimeout(() => {
                    fileState.status = 'downloaded';
                    updateUI();
                }, 100);
            }
        }
    });

    reloadIcon.addEventListener('click', () => {
        window.location.reload(); // Simple reload for the popup
    });

    // Initial UI render on load
    updateUI();
});

