const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mapping of room codes to clients
const rooms = {};

// Serve static files from a 'public' directory
app.use(express.static('public'));

// WebSocket connection setup
wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
        const data = JSON.parse(message);
        console.log("Received message:", data);  // Check what the server receives
        console.log("Received message with character name:", data.characterName);  // Check what you receive

        switch (data.type) {
            case 'create':
                const roomCode = generateRoomCode();
                console.log("Room created with code:", roomCode);
                const roomName = data.roomName || "Default Room Name"; // Set default if none provided
                rooms[roomCode] = { host: ws, players: [], maxPlayers: 5, roomName: roomName };
                ws.send(JSON.stringify({ type: 'roomCreated', roomCode: roomCode, roomName: roomName }));
                break;
            case 'join':
                const room = rooms[data.roomCode];
                if (room && room.players.length < room.maxPlayers) {
                    room.players.push(ws);
                    ws.roomCode = data.roomCode; // This sets the roomCode in the WebSocket session on the server
                    ws.send(JSON.stringify({ type: 'joined', roomName: room.roomName, roomCode: data.roomCode }));
                    room.host.send(JSON.stringify({ type: 'update', message: `${data.characterName} joined the room.` }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room full or not found' }));
                }
                break;
             case 'message':
                // Ensure characterName is being logged and used correctly
                console.log("Handling message type"); // Verify this log appears
                console.log("Setting room code on join:", data.roomCode);
                console.log("Broadcasting message from:", data.characterName);
                broadcastToRoom(data.roomCode, `${data.characterName}: ${data.message}`);
                break;
            case 'updateName':
                console.log("Character name update received:", data.characterName);
                // Find the player and update their name
                const roomToUpdate = rooms[data.roomCode];
                if (roomToUpdate) {
                    const playerToUpdate = roomToUpdate.players.find(p => p === ws);
                    if (playerToUpdate) {
                        // Assuming you have a mechanism to store the player's name on the WebSocket object or related
                        playerToUpdate.characterName = data.characterName; // This line assumes you store characterName in the ws object
                        broadcastToRoom(data.roomCode, `Character name updated to ${data.characterName}`);
                    }
                } else {
                    console.log("Room not found for code:", data.roomCode);
                }
                break;

        }
    });

    ws.on('close', function() {
        // Remove client from room on disconnect
        if (ws.roomCode) {
            let room = rooms[ws.roomCode];
            console.log("Room code when sending message:", ws.roomCode);
            room.players = room.players.filter(p => p !== ws);
            if (room.players.length === 0) {
                delete rooms[ws.roomCode];
            }
        }
    });
});

function generateRoomCode() {
    // Generate a random 5-character room code
    return Math.random().toString(36).substr(2, 5).toUpperCase();
}


function broadcastToRoom(roomCode, message) {
    // Send a message to all clients in the same room
    let room = rooms[roomCode];
    if (!room) {
        console.log("Room not found for code:", roomCode);
        return;
    }

    console.log("Broadcasting to room:", roomCode, "Message:", message);
    const fullMessage = JSON.stringify({ type: 'message', message });
    room.host.send(fullMessage);
    room.players.forEach(player => player.send(fullMessage));
}



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
