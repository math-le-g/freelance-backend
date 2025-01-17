const cron = require('node-cron');
const Facture = require('../models/Facture');
const BusinessInfo = require('../models/BusinessInfo');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const reminderService = {
  async sendReminderEmail(facture, businessInfo, subject, text) {
    try {
      await transporter.sendMail({
        from: businessInfo.email,
        to: facture.client.email,
        subject,
        text,
        html: text.replace(/\n/g, '<br>')
      });
      return true;
    } catch (error) {
      console.error('Erreur envoi email pour facture', facture.invoiceNumber, ':', error);
      return false;
    }
  },

  async processFactures() {
    try {
      const factures = await Facture.find({
        status: 'unpaid',
        dateEcheance: { $exists: true }
      }).populate('client').populate('user');

      for (const facture of factures) {
        const businessInfo = await BusinessInfo.findOne({ user: facture.user });
        
        if (!businessInfo?.features?.automaticReminders?.enabled) {
          continue;
        }

        const joursRetard = Math.floor(
          (new Date() - new Date(facture.dateEcheance)) / (1000 * 60 * 60 * 24)
        );

        const { firstReminder, secondReminder, thirdReminder } = businessInfo.features.automaticReminders;
        const montantFormatte = new Intl.NumberFormat('fr-FR', {
          style: 'currency',
          currency: 'EUR'
        }).format(facture.montantTTC);

        let rappelType = null;
        let subject = '';
        let text = '';

        if (joursRetard === firstReminder) {
          rappelType = 'premier';
          subject = `Premier rappel - Facture ${facture.invoiceNumber}`;
          text = `Cher ${facture.client.name},\n\n` +
                `Votre facture ${facture.invoiceNumber} d'un montant de ${montantFormatte} est arrivée à échéance.\n` +
                `Merci de procéder au règlement dans les plus brefs délais.\n\n` +
                `Cordialement,\n${businessInfo.name}`;
        } else if (joursRetard === secondReminder) {
          rappelType = 'deuxieme';
          subject = `Second rappel - Facture ${facture.invoiceNumber}`;
          text = `Cher ${facture.client.name},\n\n` +
                `Nous n'avons toujours pas reçu le règlement de la facture ${facture.invoiceNumber} ` +
                `d'un montant de ${montantFormatte}.\n` +
                `Merci de régulariser la situation rapidement.\n\n` +
                `Cordialement,\n${businessInfo.name}`;
        } else if (joursRetard === thirdReminder) {
          rappelType = 'troisieme';
          subject = `Dernier rappel - Facture ${facture.invoiceNumber}`;
          text = `Cher ${facture.client.name},\n\n` +
                `Ceci est notre dernier rappel concernant la facture ${facture.invoiceNumber} ` +
                `d'un montant de ${montantFormatte}.\n` +
                `Sans règlement de votre part sous 48 heures, nous serons contraints de prendre ` +
                `des mesures complémentaires.\n\n` +
                `Cordialement,\n${businessInfo.name}`;
        }

        if (rappelType && !facture.rappels?.find(r => r.type === rappelType)) {
          const emailSent = await this.sendReminderEmail(facture, businessInfo, subject, text);
          
          if (emailSent) {
            facture.rappels = facture.rappels || [];
            facture.rappels.push({
              type: rappelType,
              date: new Date(),
              status: 'sent'
            });
            await facture.save();
          }
        }
      }
    } catch (error) {
      console.error('Erreur processus de rappel:', error);
    }
  },

  async checkNow() {
    try {
      console.log('🚀 Démarrage du test de rappels...');
      await this.processFactures();
      console.log('✅ Test de rappels terminé');
    } catch (error) {
      console.error('❌ Erreur lors du test:', error);
    }
  },

  start() {
    // Exécution tous les jours à 9h
    cron.schedule('0 9 * * *', () => this.processFactures());
    console.log('📅 Service de rappels programmé pour 9h chaque jour');
  }
};

module.exports = reminderService;