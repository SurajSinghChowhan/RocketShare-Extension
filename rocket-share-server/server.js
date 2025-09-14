// This script contains the corrected logic for the signaling server.
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const sessions = {};

console.log('🚀 Signaling server is running on port 8080');

wss.on('connection', ws => {
    console.log('A new client connected!');

    ws.on('message', message => {
        const data = JSON.parse(message);
        const { sessionId, type } = data;

        if (type === 'join') {
            if (!sessions[sessionId]) {
                sessions[sessionId] = [];
            }
            sessions[sessionId].push(ws);
            console.log(`Client joined session: ${sessionId}`);

            // --- THIS IS THE FIX ---
            // If two clients are now in the session, notify BOTH of them.
            if (sessions[sessionId].length === 2) {
                console.log(`Two peers in session ${sessionId}. Notifying both.`);
                // Notify the first client (the extension)
                sessions[sessionId][0].send(JSON.stringify({ type: 'peer-joined' }));
                // Notify the second client (the mobile page)
                sessions[sessionId][1].send(JSON.stringify({ type: 'peer-joined' }));
            }
        } else {
            // Relay all other messages (offer, answer, candidate) to the other client in the session.
            const otherPeer = sessions[sessionId]?.find(client => client !== ws);
            if (otherPeer) {
                otherPeer.send(JSON.stringify(data));
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        // Clean up sessions when a client disconnects
        for (const sessionId in sessions) {
            const index = sessions[sessionId].indexOf(ws);
            if (index > -1) {
                sessions[sessionId].splice(index, 1);
                if (sessions[sessionId].length === 0) {
                    delete sessions[sessionId];
                }
                break;
            }
        }
    });
});

