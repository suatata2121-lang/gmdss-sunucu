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

    // ==========================================
    // 1. CİHAZ KAYIT SİSTEMİ (Telex, Inmarsat)
    // ==========================================
    socket.on('register', (data) => {
        if (data && data.mmsi) {
            activeVessels[socket.id] = {
                socketId: socket.id,
                name: data.name,
                mmsi: String(data.mmsi).trim(),
                imn: data.imn ? String(data.imn).trim() : undefined
            };
            console.log(`[AĞA KATILDI] ${activeVessels[socket.id].name} | MMSI: ${activeVessels[socket.id].mmsi} | IMN: ${activeVessels[socket.id].imn || 'Yok'}`);
        }
    });

    // --- YENİ EKLENEN: VHF DSC Cihaz Kaydı ---
    socket.on('register_device', (data) => {
        if (data && data.mmsi) {
            activeVessels[socket.id] = {
                socketId: socket.id,
                name: data.name || "SAILOR 6222 VHF",
                mmsi: String(data.mmsi).trim(),
                type: data.type || "VHF_DSC"
            };
            console.log(`[VHF DSC KATILDI] ${activeVessels[socket.id].name} | MMSI: ${activeVessels[socket.id].mmsi}`);
        }
    });

    // ==========================================
    // 2. MEVCUT HABERLEŞME MOTORU (INMARSAT / TELEX)
    // ==========================================
    socket.on('network_message', (msg) => {
        let senderName = msg.fromName || "Bilinmeyen";
        let targetId = msg.toId ? String(msg.toId).trim() : "Bilinmeyen";
        let protocol = msg.protocol ? String(msg.protocol).trim() : "";

        console.log(`[SİNYAL] Kimden: ${senderName} -> Kime: ${targetId} | Protokol: ${protocol}`);

        if (targetId === "BROADCAST") {
            io.emit('network_message', msg);
            return;
        }

        let targetSocketId = null;

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

    // ==========================================
    // 3. YENİ EKLENEN: VHF DSC ve SES (VOIP) MOTORU
    // ==========================================

    // A. Bireysel (Individual) veya Tüm Gemiler (All Ships) DSC Çağrısı Yönlendirme
    socket.on('send_dsc_call', (data) => {
        console.log(`[VHF DSC SİNYALİ] Kime: ${data.to} | Kanal: ${data.channel}`);
        
        if (data.to === "ALL" || data.to === "ALL SHIPS") {
            socket.broadcast.emit('receive_dsc_call', data);
            console.log(`[BAŞARILI] ALL SHIPS çağrısı filoya yayınlandı.`);
        } 
        else {
            let targetSocketId = null;
            let targetMmsi = String(data.to).trim();

            for (let id in activeVessels) {
                if (activeVessels[id].mmsi === targetMmsi) {
                    targetSocketId = activeVessels[id].socketId;
                    break;
                }
            }

            if (targetSocketId) {
                io.to(targetSocketId).emit('receive_dsc_call', data);
                console.log(`[BAŞARILI] DSC çağrısı ${targetMmsi} MMSI hedefine iletildi.`);
            } else {
                console.log(`[BAŞARISIZ] DSC Hedefi (${targetMmsi}) ağda bulunamadı!`);
            }
        }
    });

    // **!!! EKSİK OLAN VE YENİ EKLENEN BÖLÜM BURASI !!!**
    // Çağrı kabul edildiğinde (ACK) onayı arayan gemiye geri ilet
    socket.on('send_ack', (data) => {
        let targetMmsi = String(data.to).trim();
        let targetSocketId = null;

        for (let id in activeVessels) {
            if (activeVessels[id].mmsi === targetMmsi) {
                targetSocketId = activeVessels[id].socketId;
                break;
            }
        }

        if (targetSocketId) {
            io.to(targetSocketId).emit('receive_ack', data);
            console.log(`[ACK BAŞARILI] Onay sinyali ${targetMmsi} hedefine iletildi.`);
        } else {
            console.log(`[ACK BAŞARISIZ] Onay hedefi (${targetMmsi}) bulunamadı.`);
        }
    });
    // **!!! YENİ EKLENEN BÖLÜM BİTİŞİ !!!**

    // B. Tehlike (DISTRESS) İkazı (Doğrudan tüm filoya yayınlanır)
    socket.on('send_distress', (data) => {
        console.log(`[!!! MAYDAY !!!] MMSI: ${data.from} | Tür: ${data.nature}`);
        socket.broadcast.emit('receive_distress', data);
    });

    // C. PTT ve GERÇEK SES (AUDIO) İletimi (Tüm filoya yayınlanır, cihazlar kanalına göre filtreler)
    socket.on('audio_stream', (data) => {
        socket.broadcast.emit('audio_stream', data);
    });

    socket.on('ptt_start', (data) => {
        socket.broadcast.emit('ptt_start', data);
    });

    socket.on('ptt_stop', (data) => {
        socket.broadcast.emit('ptt_stop', data);
    });

    // ==========================================
    // 4. KOPMA / AYRILMA YÖNETİMİ
    // ==========================================
    socket.on('disconnect', () => {
        if (activeVessels[socket.id]) {
            console.log(`[AĞDAN KOPTU] ${activeVessels[socket.id].name} ayrıldı.`);
            delete activeVessels[socket.id];
        } else {
            console.log(`[AĞDAN KOPTU] Tanımsız bir cihaz ayrıldı. (ID: ${socket.id})`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`⚓ ZİYA KALKAVAN GMDSS SİMÜLASYON AĞI AKTİF ⚓`);
    console.log(`=================================================`);
    console.log(`Sunucu Portu : ${PORT}`);
    console.log(`Sistem dinleniyor... Kapatmak için CTRL + C basınız.`);
    console.log(`=================================================`);
});