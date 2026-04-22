// Este endpoint era usado para polling da Freepik API.
// Com Gemini a geração é síncrona — este endpoint não é mais necessário.

module.exports = async (req, res) => {
  res.status(410).json({ message: 'Polling não é mais necessário. A geração de imagem agora usa Gemini (resposta imediata).' });
};
