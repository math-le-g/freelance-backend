// Logs de débogage pour le déploiement
console.log('Démarrage du serveur - Environnement:', process.env.NODE_ENV);
console.log('Version Node:', process.version);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./models/connexion');
const authenticateToken = require('./middleware/authenticateToken');
const clientRoutes = require('./routes/clientRoutes');
const prestationRoutes = require('./routes/prestationRoutes');
const factureRoutes = require('./routes/factureRoutes');
const businessInfoRoutes = require('./routes/businessInfo');
const authRoutes = require('./routes/authRoutes');
const billingSettingsRouter = require('./routes/billingSettings');
const invoiceSettingsRoutes = require('./routes/invoiceSettingsRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const reminderService = require('./services/reminderService');
const dashboardRoutes = require('./routes/dashboardRoutes');
const descriptionRoutes = require('./routes/descriptionRoutes');
const path = require('path');

const app = express();

// Connecter à MongoDB
connectDB();

// Configuration CORS améliorée - placée avant tout autre middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://freelance-frontend-cyan.vercel.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Gérer les requêtes preflight OPTIONS explicitement
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Configuration de CORS standard (en complément)
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://freelance-frontend-cyan.vercel.app'
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization']
}));

// Middleware pour parser les requêtes JSON
app.use(express.json());

// Configuration CSP 
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; font-src 'self'; img-src 'self' https://freelance-backend-y15a.onrender.com; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' https://freelance-backend-y15a.onrender.com; connect-src 'self' https://freelance-backend-y15a.onrender.com https://freelance-frontend-cyan.vercel.app"
  );
  next();
});

// Routes Publiques
app.use('/api/auth', authRoutes);

// Routes Protégées
app.use('/api/clients', authenticateToken, clientRoutes);
app.use('/api/prestations', authenticateToken, prestationRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/factures', authenticateToken, factureRoutes);
app.use('/api/business-info', authenticateToken, businessInfoRoutes);
app.use('/api/billing-settings', authenticateToken, billingSettingsRouter);
app.use('/api/invoice-settings', authenticateToken, invoiceSettingsRoutes);
app.use('/api/reminder-service', authenticateToken, reminderRoutes);
app.use('/api/descriptions', authenticateToken, descriptionRoutes);

// Servir les fichiers statiques
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Logger les routes disponibles
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log('Route:', r.route.path)
  }
});

// Service de rappels
try {
  reminderService.start();
  console.log('✅ Service de rappels automatiques démarré');
} catch (error) {
  console.error('❌ Erreur lors du démarrage du service de rappels:', error);
}

// Gestion 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route non trouvée' });
});

// Démarrer le serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
  console.error('Erreur au démarrage du serveur:', err);
});



/*
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./models/connexion');
const authenticateToken = require('./middleware/authenticateToken');
const clientRoutes = require('./routes/clientRoutes');
const prestationRoutes = require('./routes/prestationRoutes');
const factureRoutes = require('./routes/factureRoutes');
const businessInfoRoutes = require('./routes/businessInfo');
const authRoutes = require('./routes/authRoutes');
const billingSettingsRouter = require('./routes/billingSettings');
const invoiceSettingsRoutes = require('./routes/invoiceSettingsRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const reminderService = require('./services/reminderService');
const dashboardRoutes = require('./routes/dashboardRoutes');

const descriptionRoutes = require('./routes/descriptionRoutes');
const path = require('path');

const app = express();

// Connecter à MongoDB
connectDB();

// Configuration de CORS
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://freelance-frontend-cyan.vercel.app'
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization']
}));

// Middleware pour parser les requêtes JSON
app.use(express.json());


app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; font-src 'self'; img-src 'self' https://freelance-backend-y15a.onrender.com; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' https://freelance-backend-y15a.onrender.com"
  );
  next();
});


// Routes Publiques
app.use('/api/auth', authRoutes);

// Routes Protégées
app.use('/api/clients', authenticateToken, clientRoutes);
app.use('/api/prestations', authenticateToken, prestationRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/factures', authenticateToken, factureRoutes);
app.use('/api/business-info', authenticateToken, businessInfoRoutes);
app.use('/api/billing-settings', authenticateToken, billingSettingsRouter);
app.use('/api/invoice-settings', authenticateToken, invoiceSettingsRoutes);
app.use('/api/reminder-service', authenticateToken, reminderRoutes);

app.use('/api/descriptions', authenticateToken, descriptionRoutes);

// Servir les fichiers statiques
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));


// Dans server.js, après la définition de toutes vos routes
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log('Route:', r.route.path)
  }
});


// Service de rappels
try {
  reminderService.start();
  console.log('✅ Service de rappels automatiques démarré');
} catch (error) {
  console.error('❌ Erreur lors du démarrage du service de rappels:', error);
}

// Gestion 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route non trouvée' });
});

// Démarrer le serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
*/