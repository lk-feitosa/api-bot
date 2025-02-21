require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');

const app = express();
const PORT = 4000;

// 🔹 Configuração do Redis
const client = redis.createClient();
client.connect().catch((err) => {
    console.error("❌ Erro ao conectar ao Redis:", err);
});

// 🔹 Middleware para logs organizados
app.use(morgan('tiny'));

// 🔹 Configuração de APIs externas
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error("❌ ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY ou GOOGLE_CX).");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=`;

// 🔍 **Função para buscar no Google Custom Search**
async function searchGoogle(query, retries = 3) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=10`;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔍 [${new Date().toLocaleString()}] Buscando no Google: ${query} (Tentativa ${attempt})`);
            const response = await axios.get(googleApiUrl);
            return response.data.items?.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                source: new URL(item.link).hostname
            })) || [];
        } catch (error) {
            console.error(`❌ Erro na tentativa ${attempt} de busca no Google:`, error.message);
            if (attempt === retries) throw error;
        }
    }
}

// 📜 **Endpoint principal para pesquisa de leis**
app.get(['/search', '/buscar'], async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
        }

        console.log(`\n🚀 🔹 [${new Date().toLocaleString()}] Nova pesquisa recebida: "${query}"`);

        const cacheKey = `search-law:${query}`;
        const cachedData = await client.get(cacheKey);
        if (cachedData) {
            console.log(`♻️ Resultado recuperado do cache para "${query}"`);
            return res.json(JSON.parse(cachedData));
        }

        // 🔹 Busca no Google
        let results = await searchGoogle(query);

        if (results.length > 0) {
            console.log(`✅ ${results.length} resultados encontrados para "${query}"`);
            const responsePayload = {
                message: `📜 Encontramos ${results.length} leis relacionadas.`,
                results
            };

            await client.setEx(cacheKey, 3600, JSON.stringify(responsePayload, null, 2)); // Salvar no cache por 1 hora
            return res.json(responsePayload);
        }

        // 🚫 Se não houver resultados, retorna uma mensagem simples
        console.log("⚠️ Nenhuma legislação encontrada.");
        return res.json({ message: "⚠️ Nenhuma legislação encontrada para essa pesquisa." });

    } catch (error) {
        console.error('❌ Erro ao buscar lei:', error);
        res.status(500).json({ error: 'Erro ao processar a solicitação' });
    }
});

// 🚀 **Inicia a API**
app.listen(PORT, () => {
    console.log(`\n🚀 =========================================`);
    console.log(`🚀 API de Pesquisa de Leis rodando na porta ${PORT}`);
    console.log(`🚀 Alias disponíveis: "/search" e "/buscar"`);
    console.log(`🚀 =========================================`);
});
