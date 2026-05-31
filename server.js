const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const activeVessels = {};

io.on('connection', (socket) => {
    console.log(`[BAĞLANTI] Yeni bir cihaz bağlandı. (ID: ${socket.id})`);

    socket.on('register', (data) => {
        if (data && data.mmsi) {
            // Verileri garanti altına alıyoruz (String'e çevirip boşlukları siliyoruz)
            activeVessels[socket.id] = {
                socketId: socket.id,
                name: data.name,
                mmsi: String(data.mmsi).trim(),
                imn: data.imn ? String(data.imn).trim() : undefined
            };
            console.log(`[AĞA KATILDI] ${activeVessels[socket.id].name} | MMSI: ${activeVessels[socket.id].mmsi} | IMN: ${activeVessels[socket.id].imn || 'Yok'}`);
        }
    });

    socket.on('network_message', (msg) => {
        // Gelen paketteki hedef numarayı güvenlik çemberinden geçirip temizliyoruz
        let senderName = msg.fromName || "Bilinmeyen";
        let targetId = msg.toId ? String(msg.toId).trim() : "Bilinmeyen";
        let protocol = msg.protocol ? String(msg.protocol).trim() : "";

        console.log(`[SİNYAL] Kimden: ${senderName} -> Kime: ${targetId} | Protokol: ${protocol}`);

        if (targetId === "BROADCAST") {
            io.emit('network_message', msg);
            return;
        }

        let targetSocketId = null;

        // Akıllı Eşleştirme Motoru
        for (let id in activeVessels) {
            let vessel = activeVessels[id];
            
            if (protocol === "INMARSAT" && vessel.imn === targetId) {
                targetSocketId = vessel.socketId;
                break;
            } else if (protocol !== "INMARSAT" && vessel.mmsi === targetId) {
                targetSocketId = vessel.socketId;
                break;
            }
        }

        if (targetSocketId) {
            io.to(targetSocketId).emit('network_message', msg);
            console.log(`[BAŞARILI] Mesaj ${targetId} hedefine başarıyla iletildi.`);
        } else {
            console.log(`[BAŞARISIZ] Hedef numara (${targetId}) ağda bulunamadı!`);
        }
    });

    socket.on('disconnect', () => {
        if (activeVessels[socket.id]) {
            console.log(`[AĞDAN KOPTU] ${activeVessels[socket.id].name} ayrıldı.`);
            delete activeVessels[socket.id];
        }
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`⚓ ZİYA KALKAVAN GMDSS SİMÜLASYON AĞI AKTİF ⚓`);
    console.log(`=================================================`);
    console.log(`Sunucu Portu : ${PORT}`);
    console.log(`Sistem dinleniyor... Kapatmak için CTRL + C basınız.`);
    console.log(`=================================================`);
});