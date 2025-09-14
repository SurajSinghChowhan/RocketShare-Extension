document.addEventListener('DOMContentLoaded', () => {
    const qrCodeContainer = document.getElementById('qrcode-container');
    const container = document.getElementById('container');

    // --- IMPORTANT: Double-check your computer's current IP address ---
    const ipAddress = '192.168.0.8'; // UPDATE THIS IF IT CHANGES
    const localServerUrl = `http://${ipAddress}:8081`;
    const signalingServerUrl = `ws://${ipAddress}:8080`;

    const sessionId = crypto.randomUUID();
    const mobileUrl = `${localServerUrl}?sessionId=${sessionId}`;

    new QRCode(qrCodeContainer, { text: mobileUrl, width: 190, height: 190 });
    
    const ws = new WebSocket(signalingServerUrl);
    let peerConnection;
    let dataChannel;

    // Variables for file receiving
    let receivedFileChunks = [];
    let fileMetadata = {};

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

    ws.onopen = () => {
        console.log('Desktop: Connected to signaling server.');
        ws.send(JSON.stringify({ type: 'join', sessionId }));
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Desktop: Received message:', data);

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
        
        // --- THIS IS THE NEW PART ---
        // This function handles incoming messages on the data channel
        dataChannel.onmessage = (event) => {
            try {
                // The first message should be a JSON string with file metadata
                const metadata = JSON.parse(event.data);
                if (metadata.type === 'metadata') {
                    fileMetadata = metadata;
                    receivedFileChunks = []; // Reset for a new file transfer
                    console.log('Desktop: Received metadata:', fileMetadata);
                    container.innerHTML = `<h1>Receiving...</h1><p>${fileMetadata.name}</p><div id="progressText">0%</div>`;
                }
            } catch (e) {
                // If it's not JSON, it's a raw binary file chunk (ArrayBuffer)
                receivedFileChunks.push(event.data);
                const receivedSize = receivedFileChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
                
                const progress = Math.round((receivedSize / fileMetadata.size) * 100);
                const progressText = document.getElementById('progressText');
                if (progressText) progressText.textContent = `${progress}%`;

                // When all chunks have been received
                if (receivedSize >= fileMetadata.size) {
                    console.log('Desktop: File received successfully!');
                    const fileBlob = new Blob(receivedFileChunks);
                    displayDownloadButton(fileBlob, fileMetadata.name);
                }
            }
        };
        // -----------------------------

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, sessionId }));
            }
        };

        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === 'connected') {
                container.innerHTML = '<h1>🚀 Connected!</h1><p>Ready to receive files.</p>';
            }
        };

        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                ws.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription, sessionId }));
            });
    }

    function displayDownloadButton(blob, fileName) {
        const url = URL.createObjectURL(blob);
        container.innerHTML = `
            <h1>✔️ File Received!</h1>
            <p>${fileName}</p>
            <a href="${url}" download="${fileName}" class="button">Save File</a>
        `;
        // Add a style for the button to the head
        const style = document.createElement('style');
        style.innerHTML = `
            .button { 
                display: inline-block; background-color: #007AFF; color: white; border: none;
                border-radius: 8px; padding: 12px 24px; font-size: 1em;
                font-weight: 600; cursor: pointer; text-decoration: none;
                margin-top: 10px;
            }
        `;
        document.head.appendChild(style);
    }
});

