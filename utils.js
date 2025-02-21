const natural = require('natural');

function cosineSimilarity(text1, text2) {
    const tokenizer = new natural.WordTokenizer();

    const tokens1 = tokenizer.tokenize(text1.toLowerCase());
    const tokens2 = tokenizer.tokenize(text2.toLowerCase());

    const allTokens = Array.from(new Set([...tokens1, ...tokens2]));

    const vector1 = allTokens.map(token => tokens1.includes(token) ? 1 : 0);
    const vector2 = allTokens.map(token => tokens2.includes(token) ? 1 : 0);

    const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
    const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val ** 2, 0));
    const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val ** 2, 0));

    return magnitude1 && magnitude2 ? (dotProduct / (magnitude1 * magnitude2)) : 0;
}

module.exports = { cosineSimilarity };
