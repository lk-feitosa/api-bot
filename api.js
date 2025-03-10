require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');

const app = express();
const PORT = 4000;
const RESULTS_PER_PAGE = 4;

// 🔹 Configuração do Redis
const client = redis.createClient();
client.connect().catch((err) => console.error("❌ Erro ao conectar ao Redis:", err));

// 🔹 Middleware para logs organizados
app.use(morgan('tiny'));

// 🔹 Configuração de APIs externas
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!GOOGLE_API_KEY || !GOOGLE_CX || !MISTRAL_API_KEY) {
    console.error("❌ ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY, GOOGLE_CX ou MISTRAL_API_KEY). ");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=`;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

// 📌 **Lista de palavras-chave jurídicas**
const legalKeywords = [
    "lei", "código", "regulamento", "norma", "direito", "portaria",
    "decreto", "constituição", "jurídico", "justiça", "processo", "legislação",
    "estatuto", "resolução", "tribunal", "decisão", "juiz", "promulgação", "sancionada"
];

// 📌 **Verifica se a pesquisa já é válida juridicamente**
function isLegalQuery(query) {
    const words = query.toLowerCase().split(" ");
    return words.some(word => legalKeywords.includes(word));
}

// 📌 **Adiciona "Lei" automaticamente se necessário**
function ensureLawPrefix(query) {
    const words = query.toLowerCase().split(" ");
    if (!legalKeywords.includes(words[0])) {
        return `Lei ${query}`;
    }
    return query;
}

// 📌 **Validação e reformulação da pesquisa**
async function validateAndReformulateQuery(query) {
    query = ensureLawPrefix(query); // Garante que "Lei" está no início

    if (isLegalQuery(query)) {
        return { query, suggestion: null };
    }

    try {
        console.log(`🤖 Verificando se a pesquisa faz sentido jurídico: "${query}"`);
        
        const response = await axios.post(MISTRAL_API_URL, {
            model: "mistral-small",
            messages: [{
                role: "user",
                content: `A seguinte pesquisa de lei faz sentido jurídico? "${query}". Se fizer sentido, responda apenas com "VÁLIDO". Se não fizer, reformule para algo juridicamente correto.`
            }]
        }, {
            headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` }
        });

        const reformulatedQuery = response.data.choices?.[0]?.message?.content?.trim();
        console.log(`🔍 Resposta do Mistral: "${reformulatedQuery}"`);

        if (!reformulatedQuery || reformulatedQuery.toUpperCase() === "VÁLIDO") {
            return { query, suggestion: null };
        }

        return { query: null, suggestion: reformulatedQuery };
    } catch (error) {
        console.error("❌ Erro ao validar/reformular a pesquisa com Mistral AI:", error.response?.data || error.message);
        return { query, suggestion: null };
    }
}

// 🔍 **Busca no Google Custom Search**
async function searchGoogle(query, start = 1) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=${RESULTS_PER_PAGE}&start=${start}`;

    try {
        console.log(`🔍 Buscando no Google: "${query}" (Início: ${start})`);
        const response = await axios.get(googleApiUrl);

        if (!response.data.items || response.data.items.length === 0) {
            return [];
        }

        return response.data.items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            source: new URL(item.link).hostname
        }));
    } catch (error) {
        console.error("❌ Erro na busca do Google:", error.message);
        return null;
    }
}

// 📜 **Endpoint principal para pesquisa de leis**
app.get(['/search', '/buscar'], async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const startIndex = (page - 1) * RESULTS_PER_PAGE + 1;

        if (!query) {
            return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
        }

        console.log(`🚀 🔹 [${new Date().toLocaleString()}] Nova pesquisa recebida: "${query}" (Página ${page})`);

        const { query: validatedQuery, suggestion } = await validateAndReformulateQuery(query);
        
        if (!validatedQuery) {
            return res.json({
                message: "⚠️ Sua pesquisa pode ser reformulada para algo mais adequado.",
                suggestion,
                options: ["🔍 Sim, pesquisar com a sugestão", "✍️ Não, digitar outra pesquisa"]
            });
        }

        let results = await searchGoogle(validatedQuery, startIndex);

        if (results === null) {
            return res.status(500).json({ error: "Erro ao conectar com o Google. Tente novamente mais tarde." });
        }

        if (results.length > 0) {
            return res.json({
                message: `📜 Encontramos ${results.length} leis relacionadas.`,
                results,
                nextPage: results.length === RESULTS_PER_PAGE ? `/buscar?q=${encodeURIComponent(validatedQuery)}&page=${page + 1}` : null
            });
        }

        return res.json({
            message: `⚠️ Nenhum resultado encontrado para "${query}". Tente reformular sua pesquisa.`,
            suggestion: "Tente incluir palavras-chave mais específicas, como 'Lei de trânsito' ou 'Regulamento sobre saúde'."
        });
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
