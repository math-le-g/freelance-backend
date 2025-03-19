/**
 * Script de migration pour mettre à jour toutes les prestations
 * avec les informations actualisées des factures
 * 
 * Exécuter avec: node scripts/updatePrestationsWithInvoiceInfo.js
 */

const mongoose = require('mongoose');
const Facture = require('../models/Facture');
const Prestation = require('../models/Prestation');
require('dotenv').config();

async function migrateData() {
  try {
    // Connexion à la base de données
    console.log('Tentative de connexion à MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connecté à MongoDB');

    // 1. Vérifier et créer les nouveaux champs dans le schéma Prestation si nécessaire
    console.log('Vérification du schéma de prestation...');
    
    // 2. Mettre à jour toutes les factures qui n'ont pas encore le champ isSentToClient
    console.log('Mise à jour des factures sans champ isSentToClient...');
    const facturesWithoutIsSentToClient = await Facture.countDocuments({ isSentToClient: { $exists: false } });
    
    if (facturesWithoutIsSentToClient > 0) {
      console.log(`${facturesWithoutIsSentToClient} factures à mettre à jour...`);
      
      // Les factures draft sont considérées comme non envoyées
      const draftResult = await Facture.updateMany(
        { 
          isSentToClient: { $exists: false },
          status: 'draft'
        },
        { $set: { isSentToClient: false } }
      );
      
      console.log(`- ${draftResult.modifiedCount} factures draft marquées comme non envoyées`);
      
      // Les autres factures sont considérées comme envoyées
      const otherResult = await Facture.updateMany(
        { 
          isSentToClient: { $exists: false },
          status: { $ne: 'draft' }
        },
        { $set: { isSentToClient: true } }
      );
      
      console.log(`- ${otherResult.modifiedCount} autres factures marquées comme envoyées`);
    } else {
      console.log('Toutes les factures ont déjà le champ isSentToClient.');
    }

    // 3. Trouver toutes les factures
    const factures = await Facture.find({});
    console.log(`${factures.length} factures trouvées, début de la migration des prestations...`);

    let updatedCount = 0;
    let totalPrestationsCount = 0;

    // 4. Pour chaque facture, mettre à jour ses prestations
    for (const facture of factures) {
      // Déterminer les valeurs à mettre à jour
      const updateData = {
        invoiceStatus: facture.status || 'draft',
        invoiceIsSentToClient: facture.isSentToClient || facture.status !== 'draft',
        invoiceLocked: facture.locked || false,
        invoicePaid: facture.status === 'paid'
      };

      // Trouver les prestations associées à cette facture
      const count = await Prestation.countDocuments({ invoiceId: facture._id });
      
      if (count > 0) {
        // Mettre à jour toutes les prestations associées
        const result = await Prestation.updateMany(
          { invoiceId: facture._id },
          { $set: updateData }
        );

        updatedCount += result.modifiedCount;
        totalPrestationsCount += count;
        
        console.log(`Facture #${facture.invoiceNumber}: ${result.modifiedCount}/${count} prestations mises à jour`);
      }
    }

    console.log(`\nMigration terminée: ${updatedCount}/${totalPrestationsCount} prestations mises à jour au total.`);

  } catch (error) {
    console.error('Erreur lors de la migration:', error);
  } finally {
    // Fermer la connexion
    console.log('Fermeture de la connexion à MongoDB...');
    await mongoose.connection.close();
    console.log('Migration terminée.');
  }
}

// Exécuter la migration
migrateData();