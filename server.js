const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// ⚠️ REMPLACEZ CES VALEURS PAR VOS CLÉS SUPABASE
const SUPABASE_URL = 'https://bpfugczlnhnncpaxhhwv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZnVnY3psbmhubmNwYXhoaHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDMxMzEsImV4cCI6MjA4MDk3OTEzMX0.wZEW2XEOJbEfNrVDZ2fq5qHkmIrA8FQIP_wuB-9w2Yw';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Helper functions
async function getAllData() {
    try {
        // Get rooms
        const { data: rooms, error: roomsError } = await supabase
            .from('rooms')
            .select('*')
            .order('id');
        
        if (roomsError) throw roomsError;

        // Get occupants with their codes
        const { data: occupants, error: occupantsError } = await supabase
            .from('occupants')
            .select('*');
        
        if (occupantsError) throw occupantsError;

        // Get participants
        const { data: participants, error: participantsError } = await supabase
            .from('participants')
            .select('name')
            .order('name');
        
        if (participantsError) throw participantsError;

        // Format data
        const registrationCodes = {};
        const roomsWithOccupants = rooms.map(room => ({
            id: room.id,
            capacity: room.capacity,
            type: room.type,
            isFemaleOnly: room.is_female_only,
            occupants: []
        }));

        occupants.forEach(occ => {
            const room = roomsWithOccupants.find(r => r.id === occ.room_id);
            if (room) {
                room.occupants.push(occ.name);
            }
            registrationCodes[occ.name] = {
                code: occ.registration_code,
                roomId: occ.room_id
            };
        });

        return {
            rooms: roomsWithOccupants,
            participants: participants.map(p => p.name),
            registrationCodes
        };
    } catch (error) {
        console.error('Error getting data:', error);
        throw error;
    }
}

// API Routes
app.get('/api/data', async (req, res) => {
    try {
        const data = await getAllData();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/assign', async (req, res) => {
    try {
        const { roomId, members } = req.body;
        
        // Get current occupants
        const { data: currentOccupants } = await supabase
            .from('occupants')
            .select('name, room_id');

        // Check duplicates
        const alreadyAssigned = members.filter(member => 
            currentOccupants.some(o => o.name === member)
        );

        if (alreadyAssigned.length > 0) {
            return res.status(400).json({ 
                error: `Ces personnes sont déjà inscrites : ${alreadyAssigned.join(', ')}` 
            });
        }

        // Check capacity
        const roomOccupants = currentOccupants.filter(o => o.room_id === roomId);
        const { data: room } = await supabase
            .from('rooms')
            .select('capacity')
            .eq('id', roomId)
            .single();

        if (roomOccupants.length + members.length > room.capacity) {
            return res.status(400).json({ 
                error: `Pas assez de places ! (${room.capacity - roomOccupants.length} places restantes)` 
            });
        }

        // Generate code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Insert occupants
        const occupantsToInsert = members.map(member => ({
            room_id: roomId,
            name: member,
            registration_code: code
        }));

        const { error: insertError } = await supabase
            .from('occupants')
            .insert(occupantsToInsert);

        if (insertError) throw insertError;

        const data = await getAllData();
        res.json({ success: true, code, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/modify', async (req, res) => {
    try {
        const { roomId, code } = req.body;
        
        // Find occupants with this code in this room
        const { data: occupants, error: findError } = await supabase
            .from('occupants')
            .select('*')
            .eq('room_id', roomId)
            .eq('registration_code', code.toUpperCase());

        if (findError) throw findError;

        if (!occupants || occupants.length === 0) {
            return res.status(401).json({ error: 'Code incorrect !' });
        }

        const groupMembers = occupants.map(o => o.name);

        // Delete all occupants with this code
        const { error: deleteError } = await supabase
            .from('occupants')
            .delete()
            .eq('registration_code', code.toUpperCase());

        if (deleteError) throw deleteError;

        const data = await getAllData();
        res.json({ success: true, groupMembers, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/remove', async (req, res) => {
    try {
        const { roomId, occupant, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        const { error: deleteError } = await supabase
            .from('occupants')
            .delete()
            .eq('room_id', roomId)
            .eq('name', occupant);

        if (deleteError) throw deleteError;

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/toggle-female', async (req, res) => {
    try {
        const { roomId, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Get current value
        const { data: room } = await supabase
            .from('rooms')
            .select('is_female_only')
            .eq('id', roomId)
            .single();

        // Toggle
        const { error: updateError } = await supabase
            .from('rooms')
            .update({ is_female_only: !room.is_female_only })
            .eq('id', roomId);

        if (updateError) throw updateError;

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/upload-participants', async (req, res) => {
    try {
        const { participants, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Insert new participants (ignore duplicates)
        for (const name of participants) {
            await supabase
                .from('participants')
                .upsert({ name }, { onConflict: 'name' });
        }

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/update-participants', async (req, res) => {
    try {
        const { participants, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Get current participants
        const { data: current } = await supabase
            .from('participants')
            .select('name');

        const currentNames = new Set(current.map(p => p.name));
        const newNames = new Set(participants);

        // Delete removed participants
        const toDelete = [...currentNames].filter(name => !newNames.has(name));
        if (toDelete.length > 0) {
            await supabase
                .from('participants')
                .delete()
                .in('name', toDelete);
        }

        // Add new participants
        const toAdd = [...newNames].filter(name => !currentNames.has(name));
        if (toAdd.length > 0) {
            await supabase
                .from('participants')
                .insert(toAdd.map(name => ({ name })));
        }

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/reset', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Delete all occupants
        await supabase.from('occupants').delete().neq('id', 0);

        // Reset all rooms to not female only
        await supabase
            .from('rooms')
            .update({ is_female_only: false })
            .neq('id', '');

        // Delete all participants
        await supabase.from('participants').delete().neq('id', 0);

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
    console.log(`Supabase URL: ${SUPABASE_URL}`);
});
