const express = require('express');
const router = express.Router();
const reminderService = require('../services/reminderService');
const authenticateToken = require('../middleware/authenticateToken');

router.post('/test-reminder', authenticateToken, async (req, res) => {
  try {
    // Récupérer une facture impayée pour test
    const facture = await Facture.findOne({
      user: req.user._id,
      status: { $ne: 'payee' }
    }).populate('client').populate('user');

    if (!facture) {
      return res.status(404).json({ message: 'Aucune facture impayée trouvée' });
    }

    // Récupérer les paramètres business
    const businessInfo = await BusinessInfo.findOne({ user: req.user._id });
    if (!businessInfo) {
      return res.status(404).json({ message: 'Paramètres business non trouvés' });
    }

    // Tester l'envoi
    const result = await reminderService.processFacture(facture, businessInfo);
    
    res.json({
      success: true,
      message: 'Test de rappel effectué',
      result
    });
  } catch (error) {
    console.error('Erreur lors du test de rappel:', error);
    res.status(500).json({ message: 'Erreur lors du test de rappel' });
  }
});

module.exports = router;