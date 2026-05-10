const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    console.log('Bağlandı:', socket.id);

    socket.on('joinGame', () => {
        let targetRoom = null;
        for (let room in rooms) {
            if (rooms[room].players.length === 1) {
                targetRoom = room;
                break;
            }
        }
        if (!targetRoom) {
            targetRoom = `room_${Date.now()}`;
            rooms[targetRoom] = {
                players: [],
                settings: {
                    ceylanLossLimit: 5,
                    hakkiLossLimit: 5,
                    hakkiMode: 'normal',
                    prize: ''
                },
                gameState: {
                    started: false,
                    scores: { ceylan: 0, hakki: 0 },
                    deaths: { ceylan: 0, hakki: 0 },
                    ready: [],
                    positions: {  // Rakip pozisyonları için
                        ceylan: { y: 160, velocity: 0, alive: true },
                        hakki: { y: 160, velocity: 0, alive: true }
                    }
                }
            };
        }
        
        socket.join(targetRoom);
        const assignedChar = rooms[targetRoom].players.length === 0 ? 'ceylan' : 'hakki';
        
        rooms[targetRoom].players.push({
            id: socket.id,
            character: assignedChar
        });
        
        socket.emit('assignedCharacter', assignedChar);
        socket.emit('roomJoined', targetRoom);
        
        if (rooms[targetRoom].players.length === 2) {
            io.to(targetRoom).emit('bothPlayersReady', rooms[targetRoom].settings);
        }
    });
    
    // Pozisyon güncelleme (her frame'de gönderilecek)
    socket.on('positionUpdate', ({ room, character, y, velocity, score, deaths, alive }) => {
        if (rooms[room] && rooms[room].gameState.started) {
            rooms[room].gameState.positions[character] = { y, velocity, alive };
            rooms[room].gameState.scores[character] = score;
            rooms[room].gameState.deaths[character] = deaths;
            
            // Rakibe gönder
            socket.to(room).emit('opponentPosition', {
                character,
                y,
                velocity,
                score,
                deaths,
                alive
            });
            
            // Oyun bitiş kontrolü
            const settings = rooms[room].settings;
            const d = rooms[room].gameState.deaths;
            let winner = null, loser = null;
            
            if (settings.hakkiMode === 'ask') {
                if (d.ceylan >= settings.ceylanLossLimit || d.hakki >= settings.ceylanLossLimit) {
                    winner = 'ceylan'; loser = 'hakki';
                }
            } else {
                if (d.ceylan >= settings.ceylanLossLimit) {
                    winner = 'hakki'; loser = 'ceylan';
                } else if (d.hakki >= settings.hakkiLossLimit) {
                    winner = 'ceylan'; loser = 'hakki';
                }
            }
            
            if (winner) {
                rooms[room].gameState.started = false;
                io.to(room).emit('gameOver', { winner, loser, prize: settings.prize });
                delete rooms[room];
            }
        }
    });
    
    socket.on('updateSettings', ({ room, settings }) => {
        if (rooms[room]) {
            rooms[room].settings = { ...rooms[room].settings, ...settings };
            socket.to(room).emit('settingsUpdated', rooms[room].settings);
        }
    });
    
    socket.on('playerReady', ({ room, character }) => {
        if (rooms[room]) {
            if (!rooms[room].gameState.ready.includes(character)) {
                rooms[room].gameState.ready.push(character);
            }
            if (rooms[room].gameState.ready.length === 2) {
                rooms[room].gameState.started = true;
                rooms[room].gameState.scores = { ceylan: 0, hakki: 0 };
                rooms[room].gameState.deaths = { ceylan: 0, hakki: 0 };
                rooms[room].gameState.positions = {
                    ceylan: { y: 160, velocity: 0, alive: true },
                    hakki: { y: 160, velocity: 0, alive: true }
                };
                io.to(room).emit('gameStart', {
                    deaths: rooms[room].gameState.deaths,
                    settings: rooms[room].settings
                });
            }
        }
    });
    
    socket.on('disconnect', () => {
        for (let room in rooms) {
            const index = rooms[room].players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                io.to(room).emit('opponentDisconnected');
                delete rooms[room];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
