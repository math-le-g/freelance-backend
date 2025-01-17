const express = require('express');
const router = express.Router();
const BusinessInfo = require('../models/BusinessInfo');
const Facture = require('../models/Facture');


// GET /api/invoice-settings
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const businessInfo = await BusinessInfo.findOne({ user: userId });

    if (!businessInfo) {
      return res.status(404).json({ message: 'Informations de l\'entreprise non trouvées.' });
    }

    res.json({
      invoiceTitle: businessInfo.invoiceTitle,
      invoiceNumberStart: businessInfo.invoiceNumberStart,
      currentInvoiceNumber: businessInfo.currentInvoiceNumber,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des paramètres de facturation:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des paramètres de facturation.' });
  }
});

// POST /api/invoice-settings
router.post('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const { invoiceNumberStart, invoiceTitle } = req.body;

    // Validation du numéro de départ
    if (invoiceNumberStart !== undefined && (typeof invoiceNumberStart !== 'number' || invoiceNumberStart < 1)) {
      return res.status(400).json({ message: 'Un numéro de départ valide est requis.' });
    }

    // Récupérer le dernier numéro de facture émis
    const lastInvoice = await Facture.findOne({ user: userId }).sort({ invoiceNumber: -1 });
    const lastInvoiceNumber = lastInvoice ? lastInvoice.invoiceNumber : 0;

    if (invoiceNumberStart !== undefined && invoiceNumberStart <= lastInvoiceNumber) {
      return res.status(400).json({
        message: `Le numéro de départ doit être supérieur au dernier numéro de facture émis (${lastInvoiceNumber}).`,
      });
    }

    // Mettre à jour les informations de l'entreprise
    let businessInfo = await BusinessInfo.findOne({ user: userId });
    if (!businessInfo) {
      businessInfo = new BusinessInfo({ user: userId });
    }

    if (invoiceTitle !== undefined) {
      businessInfo.invoiceTitle = invoiceTitle;
    }

    if (invoiceNumberStart !== undefined) {
      businessInfo.invoiceNumberStart = invoiceNumberStart;
    }

    await businessInfo.save();

    res.json({
      invoiceTitle: businessInfo.invoiceTitle,
      invoiceNumberStart: businessInfo.invoiceNumberStart,
      currentInvoiceNumber: businessInfo.currentInvoiceNumber,
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour des paramètres de facturation:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour des paramètres de facturation.' });
  }
});

// GET /api/invoice-settings/last-number
router.get('/last-number', async (req, res) => {
  try {
    const userId = req.user._id;
    const lastInvoice = await Facture.findOne({ user: userId }).sort({ invoiceNumber: -1 });
    const lastInvoiceNumber = lastInvoice ? lastInvoice.invoiceNumber : 0;
    res.json({ lastInvoiceNumber });
  } catch (error) {
    console.error('Erreur lors de la récupération du dernier numéro de facture:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du dernier numéro de facture.' });
  }
});

module.exports = router;
