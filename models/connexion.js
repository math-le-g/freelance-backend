// Import de Mongoose
const mongoose = require('mongoose');

// Récupération de la chaîne de connexion depuis les variables d'environnement
const connectionString = process.env.CONNECTION_STRING;

// Fonction asynchrone pour gérer la connexion à MongoDB
const connectDB = async () => {
    try {
        // Ajouter les options pour éviter les avertissements de dépréciation
        await mongoose.connect(connectionString, {
            connectTimeoutMS: 2000        // Temps limite de connexion
        });
        console.log('Base de données connectée !');
    } catch (error) {
        console.error('Erreur lors de la connexion à MongoDB:', error);
        process.exit(1); // Arrêter le processus si la connexion échoue
    }
};

module.exports = connectDB;

