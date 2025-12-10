const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Data file
const DATA_FILE = 'data.json';

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
        rooms: [
            // Chambres de 2 lits (n°2 à n°6)
            ...Array(5).fill(null).map((_, i) => ({
                id: `${i+2}`,
                capacity: 2,
                type: '2 lits',
                occupants: [],
                isFemaleOnly: false
            })),
            // Chambres de 6 lits (n°7 à n°10)
            ...Array(4).fill(null).map((_, i) => ({
                id: `${i+7}`,
                capacity: 6,
                type: '6 lits',
                occupants: [],
                isFemaleOnly: false
            })),
            // Chambres de 5 lits (n°11 à n°19)
            ...Array(9).fill(null).map((_, i) => ({
                id: `${i+11}`,
                capacity: 5,
                type: '5 lits',
                occupants: [],
                isFemaleOnly: false
            })),
            // Chambres de 3 lits
            { id: '20', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: '21', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: '22', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: '25', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: '26', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: 'C', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: 'E', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: 'G', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
            { id: 'I', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false }
        ],
        participants: [],
        registrationCodes: {}
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
}

// Helper functions
function readData() {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// API Routes
app.get('/api/data', (req, res) => {
    const data = readData();
    res.json(data);
});

app.post('/api/assign', (req, res) => {
    try {
        const { roomId, members } = req.body;
        const data = readData();
        
        const room = data.rooms.find(r => r.id === roomId);
        if (!room) {
            return res.status(404).json({ error: 'Chambre non trouvée' });
        }

        // Check duplicates
        const alreadyAssigned = members.filter(member => 
            data.rooms.some(r => r.occupants.includes(member))
        );

        if (alreadyAssigned.length > 0) {
            return res.status(400).json({ 
                error: `Ces personnes sont déjà inscrites : ${alreadyAssigned.join(', ')}` 
            });
        }

        // Check capacity
        if (room.occupants.length + members.length > room.capacity) {
            return res.status(400).json({ 
                error: `Pas assez de places ! (${room.capacity - room.occupants.length} places restantes)` 
            });
        }

        // Generate code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Assign
        room.occupants.push(...members);
        members.forEach(member => {
            data.registrationCodes[member] = { code, roomId };
        });

        writeData(data);
        res.json({ success: true, code, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/modify', (req, res) => {
    try {
        const { roomId, code } = req.body;
        const data = readData();
        
        const room = data.rooms.find(r => r.id === roomId);
        if (!room) {
            return res.status(404).json({ error: 'Chambre non trouvée' });
        }

        const matchingOccupant = room.occupants.find(occupant => 
            data.registrationCodes[occupant]?.code === code.toUpperCase()
        );

        if (!matchingOccupant) {
            return res.status(401).json({ error: 'Code incorrect !' });
        }

        const groupCode = data.registrationCodes[matchingOccupant].code;
        const groupMembers = room.occupants.filter(occupant => 
            data.registrationCodes[occupant]?.code === groupCode
        );

        room.occupants = room.occupants.filter(o => !groupMembers.includes(o));

        writeData(data);
        res.json({ success: true, groupMembers, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/remove', (req, res) => {
    try {
        const { roomId, occupant, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        const data = readData();
        const room = data.rooms.find(r => r.id === roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Chambre non trouvée' });
        }

        room.occupants = room.occupants.filter(o => o !== occupant);
        delete data.registrationCodes[occupant];

        writeData(data);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/toggle-female', (req, res) => {
    try {
        const { roomId, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        const data = readData();
        const room = data.rooms.find(r => r.id === roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Chambre non trouvée' });
        }

        room.isFemaleOnly = !room.isFemaleOnly;

        writeData(data);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/upload-participants', (req, res) => {
    try {
        const { participants, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        const data = readData();
        data.participants = participants;

        writeData(data);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/reset', (req, res) => {
    try {
        const { password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Reset to initial state
        const initialData = {
            rooms: [
                ...Array(5).fill(null).map((_, i) => ({
                    id: `${i+2}`,
                    capacity: 2,
                    type: '2 lits',
                    occupants: [],
                    isFemaleOnly: false
                })),
                ...Array(4).fill(null).map((_, i) => ({
                    id: `${i+7}`,
                    capacity: 6,
                    type: '6 lits',
                    occupants: [],
                    isFemaleOnly: false
                })),
                ...Array(9).fill(null).map((_, i) => ({
                    id: `${i+11}`,
                    capacity: 5,
                    type: '5 lits',
                    occupants: [],
                    isFemaleOnly: false
                })),
                { id: '20', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: '21', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: '22', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: '25', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: '26', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: 'C', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: 'E', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: 'G', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false },
                { id: 'I', capacity: 3, type: '3 lits', occupants: [], isFemaleOnly: false }
            ],
            participants: [],
            registrationCodes: {}
        };

        writeData(initialData);
        res.json({ success: true, data: initialData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
