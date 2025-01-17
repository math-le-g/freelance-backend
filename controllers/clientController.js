const Client = require('../models/Client');

// Ajouter un client
exports.addClient = async (req, res) => {
  const { name, email, address } = req.body;
  const userId = req.user._id; // Récupérer l'ID de l'utilisateur connecté

  try {
    // Vérifier si le client existe déjà pour cet utilisateur
    const existingClient = await Client.findOne({ email, user: userId });
    if (existingClient) {
      return res.status(400).json({ message: 'Le client existe déjà' });
    }

    // Créer un nouveau client
    const newClient = new Client({ user: userId, name, email, address });
    await newClient.save();

    res.status(201).json({ message: 'Client ajouté avec succès', client: newClient });
  } catch (error) {
    console.error('Erreur lors de l\'ajout du client:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout du client', error });
  }
};

// Obtenir les clients d'un utilisateur
exports.getClients = async (req, res) => {
  const userId = req.user._id; // Récupérer l'ID de l'utilisateur connecté

  try {
    const clients = await Client.find({ user: userId });
    res.status(200).json(clients);
  } catch (error) {
    console.error('Erreur lors de la récupération des clients:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des clients', error });
  }
};

// Mettre à jour un client
exports.updateClient = async (req, res) => {
  const clientId = req.params.clientId;
  const { name, email, address } = req.body;
  const userId = req.user._id; // Récupérer l'ID de l'utilisateur connecté

  try {
    const client = await Client.findOneAndUpdate(
      { _id: clientId, user: userId },
      { name, email, address },
      { new: true }
    );

    if (!client) {
      return res.status(404).json({ message: 'Client non trouvé' });
    }

    res.status(200).json({ message: 'Client mis à jour', client });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du client:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du client', error });
  }
};

// Supprimer un client
exports.deleteClient = async (req, res) => {
  const clientId = req.params.clientId;
  const userId = req.user._id; // Récupérer l'ID de l'utilisateur connecté

  try {
    const client = await Client.findOneAndDelete({ _id: clientId, user: userId });

    if (!client) {
      return res.status(404).json({ message: 'Client non trouvé' });
    }

    res.status(200).json({ message: 'Client supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression du client:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du client', error });
  }
};
