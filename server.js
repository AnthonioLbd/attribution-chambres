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
        const { data: rooms, error: roomsError } = await supabase
            .from('rooms')
            .select('*');
        
        if (roomsError) throw roomsError;

        const { data: occupants, error: occupantsError } = await supabase
            .from('occupants')
            .select('*');
        
        if (occupantsError) throw occupantsError;

        const { data: participants, error: participantsError } = await supabase
            .from('participants')
            .select('name')
            .order('name');
        
        if (participantsError) throw participantsError;

        const registrationCodes = {};
        const roomsWithOccupants = rooms.map(room => ({
            id: room.id,
            capacity: room.capacity,
            type: room.type,
            isFemaleOnly: room.is_female_only,
            genderPreference: room.gender_preference || 'mixed',
            userPreference: room.user_preference || false,
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

        const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);

        return {
            rooms: roomsWithOccupants,
            participants: participants.map(p => p.name),
            registrationCodes,
            totalCapacity
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
        const { roomId, members, genderPreference } = req.body;
        
        const { data: currentOccupants } = await supabase
            .from('occupants')
            .select('name, room_id');

        const alreadyAssigned = members.filter(member => 
            currentOccupants.some(o => o.name === member)
        );

        if (alreadyAssigned.length > 0) {
            return res.status(400).json({ 
                error: `Ces personnes sont déjà inscrites : ${alreadyAssigned.join(', ')}` 
            });
        }

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

        // If this is the first reservation and gender preference is set
        if (roomOccupants.length === 0 && genderPreference && genderPreference !== 'mixed') {
            await supabase
                .from('rooms')
                .update({ 
                    gender_preference: genderPreference,
                    user_preference: true 
                })
                .eq('id', roomId);
        }

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

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

        const { error: deleteError } = await supabase
            .from('occupants')
            .delete()
            .eq('registration_code', code.toUpperCase());

        if (deleteError) throw deleteError;

        // Check if room is now empty, reset gender preference if it was user-set
        const { data: remainingOccupants } = await supabase
            .from('occupants')
            .select('id')
            .eq('room_id', roomId);

        if (remainingOccupants.length === 0) {
            await supabase
                .from('rooms')
                .update({ 
                    gender_preference: 'mixed',
                    user_preference: false 
                })
                .eq('id', roomId)
                .eq('user_preference', true);
        }

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

        // Check if room is now empty
        const { data: remainingOccupants } = await supabase
            .from('occupants')
            .select('id')
            .eq('room_id', roomId);

        if (remainingOccupants.length === 0) {
            await supabase
                .from('rooms')
                .update({ 
                    gender_preference: 'mixed',
                    user_preference: false 
                })
                .eq('id', roomId)
                .eq('user_preference', true);
        }

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

        const { data: room } = await supabase
            .from('rooms')
            .select('is_female_only')
            .eq('id', roomId)
            .single();

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

        const { data: current } = await supabase
            .from('participants')
            .select('name');

        const currentNames = new Set(current.map(p => p.name));
        const newNames = new Set(participants);

        const toDelete = [...currentNames].filter(name => !newNames.has(name));
        if (toDelete.length > 0) {
            // Delete from participants table
            await supabase
                .from('participants')
                .delete()
                .in('name', toDelete);

            // Also delete from occupants table (remove from rooms)
            await supabase
                .from('occupants')
                .delete()
                .in('name', toDelete);

            // Reset gender preference for affected rooms
            const { data: affectedRooms } = await supabase
                .from('occupants')
                .select('room_id')
                .in('name', toDelete);

            if (affectedRooms) {
                const roomIds = [...new Set(affectedRooms.map(r => r.room_id))];
                for (const roomId of roomIds) {
                    const { data: remainingOccupants } = await supabase
                        .from('occupants')
                        .select('id')
                        .eq('room_id', roomId);

                    if (!remainingOccupants || remainingOccupants.length === 0) {
                        await supabase
                            .from('rooms')
                            .update({ 
                                gender_preference: 'mixed',
                                user_preference: false 
                            })
                            .eq('id', roomId);
                    }
                }
            }
        }

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

app.post('/api/admin/edit-participant', async (req, res) => {
    try {
        const { oldName, newName, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Update in participants table
        await supabase
            .from('participants')
            .update({ name: newName })
            .eq('name', oldName);

        // Update in occupants table (update in rooms)
        await supabase
            .from('occupants')
            .update({ name: newName })
            .eq('name', oldName);

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/delete-participant', async (req, res) => {
    try {
        const { name, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Get room info before deleting
        const { data: occupant } = await supabase
            .from('occupants')
            .select('room_id')
            .eq('name', name)
            .single();

        // Delete from participants
        await supabase
            .from('participants')
            .delete()
            .eq('name', name);

        // Delete from occupants (remove from room)
        await supabase
            .from('occupants')
            .delete()
            .eq('name', name);

        // Check if room is now empty and reset preference
        if (occupant) {
            const { data: remainingOccupants } = await supabase
                .from('occupants')
                .select('id')
                .eq('room_id', occupant.room_id);

            if (!remainingOccupants || remainingOccupants.length === 0) {
                await supabase
                    .from('rooms')
                    .update({ 
                        gender_preference: 'mixed',
                        user_preference: false 
                    })
                    .eq('id', occupant.room_id);
            }
        }

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/clear-room', async (req, res) => {
    try {
        const { roomId, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Delete all occupants from this room
        await supabase
            .from('occupants')
            .delete()
            .eq('room_id', roomId);

        // Reset gender preference
        await supabase
            .from('rooms')
            .update({ 
                gender_preference: 'mixed',
                user_preference: false 
            })
            .eq('id', roomId);

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/clear-participants', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        await supabase.from('participants').delete().neq('id', 0);

        const data = await getAllData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/update-rooms', async (req, res) => {
    try {
        const { rooms, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // Delete all occupants first (they will be orphaned anyway)
        await supabase.from('occupants').delete().neq('id', 0);

        // Delete all current rooms
        await supabase.from('rooms').delete().neq('id', '');

        // Insert new rooms if any
        if (rooms.length > 0) {
            const roomsToInsert = rooms.map(room => ({
                id: room.id,
                capacity: room.capacity,
                type: room.type,
                is_female_only: false,
                gender_preference: 'mixed',
                user_preference: false
            }));

            const { error: insertError } = await supabase
                .from('rooms')
                .insert(roomsToInsert);

            if (insertError) throw insertError;
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

        await supabase.from('occupants').delete().neq('id', 0);

        await supabase
            .from('rooms')
            .update({ 
                is_female_only: false,
                gender_preference: 'mixed',
                user_preference: false
            })
            .neq('id', '');

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
