const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname));

// Oyun odaları için
const rooms = {};

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    socket.on('joinGame', () => {
        // Mevcut bir oda bul veya oluştur
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
                    scores: {},
                    deaths: {},
                    waiting: []
                }
            };
        }
        
        socket.join(targetRoom);
        const playerId = socket.id;
        let assignedChar = null;
        
        if (rooms[targetRoom].players.length === 0) {
            assignedChar = 'ceylan';
        } else if (rooms[targetRoom].players.length === 1) {
            assignedChar = 'hakki';
        } else {
            socket.emit('roomFull');
            return;
        }
        
        rooms[targetRoom].players.push({
            id: playerId,
            character: assignedChar,
            socketId: socket.id
        });
        
        socket.emit('assignedCharacter', assignedChar);
        socket.emit('roomJoined', targetRoom);
        
        // Odada 2 kişi olduğunda ikisine de hazır olduğunu bildir
        if (rooms[targetRoom].players.length === 2) {
            io.to(targetRoom).emit('bothPlayersReady', rooms[targetRoom].settings);
        }
    });
    
    socket.on('updateSettings', ({ room, settings }) => {
        if (rooms[room]) {
            rooms[room].settings = { ...rooms[room].settings, ...settings };
            // Diğer oyuncuya ayarların güncellendiğini bildir
            socket.to(room).emit('settingsUpdated', rooms[room].settings);
        }
    });
    
    socket.on('playerReady', ({ room, character }) => {
        if (rooms[room]) {
            if (!rooms[room].gameState.waiting.includes(character)) {
                rooms[room].gameState.waiting.push(character);
            }
            if (rooms[room].gameState.waiting.length === 2) {
                // İki oyuncu da hazır
                rooms[room].gameState.started = true;
                rooms[room].gameState.scores = { ceylan: 0, hakki: 0 };
                rooms[room].gameState.deaths = { ceylan: 0, hakki: 0 };
                io.to(room).emit('gameStart', {
                    deaths: rooms[room].gameState.deaths,
                    settings: rooms[room].settings
                });
            }
        }
    });
    
    socket.on('scoreUpdate', ({ room, character, score, deathCount }) => {
        if (rooms[room] && rooms[room].gameState.started) {
            rooms[room].gameState.scores[character] = score;
            rooms[room].gameState.deaths[character] = deathCount;
            
            // Oyun bitti mi kontrol et
            const settings = rooms[room].settings;
            const deaths = rooms[room].gameState.deaths;
            let winner = null;
            let loser = null;
            
            if (settings.hakkiMode === 'ask') {
                // Aşk modu: Ceylan her zaman kazanır
                if (deaths.ceylan >= settings.ceylanLossLimit || deaths.hakki >= settings.ceylanLossLimit) {
                    winner = 'ceylan';
                    loser = 'hakki';
                }
            } else {
                // Normal mod: İlk hedefe ulaşan kaybeder
                if (deaths.ceylan >= settings.ceylanLossLimit) {
                    winner = 'hakki';
                    loser = 'ceylan';
                } else if (deaths.hakki >= settings.hakkiLossLimit) {
                    winner = 'ceylan';
                    loser = 'hakki';
                }
            }
            
            if (winner) {
                rooms[room].gameState.started = false;
                io.to(room).emit('gameOver', {
                    winner,
                    loser,
                    prize: settings.prize
                });
                // Odayı sıfırla
                delete rooms[room];
            } else {
                // Güncel durumu her iki tarafa da gönder
                io.to(room).emit('stateUpdate', {
                    scores: rooms[room].gameState.scores,
                    deaths: rooms[room].gameState.deaths
                });
            }
        }
    });
    
    socket.on('disconnect', () => {
        for (let room in rooms) {
            const index = rooms[room].players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                rooms[room].players.splice(index, 1);
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
