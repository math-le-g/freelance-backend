const express = require('express');
const router = express.Router();
const reminderService = require('../services/reminderService');


router.post('/check-now', async (req, res) => {
  try {
    await reminderService.checkNow();
    res.json({ message: 'Test des rappels effectué' });
  } catch (error) {
    console.error('Erreur lors du test:', error);
    res.status(500).json({ message: 'Erreur lors du test des rappels' });
  }
});

module.exports = router;