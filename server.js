const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// ====================================================================
// CONFIGURATION SUPABASE
// ====================================================================
const SUPABASE_URL = 'https://bpfugczlnhnncpaxhhwv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZnVnY3psbmhubmNwYXhoaHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDMxMzEsImV4cCI6MjA4MDk3OTEzMX0.wZEW2XEOJbEfNrVDZ2fq5qHkmIrA8FQIP_wuB-9w2Yw';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ====================================================================
// MIDDLEWARE
// ====================================================================
app.use(express.json());
app.use(express.static('public'));

// ====================================================================
// FONCTIONS UTILITAIRES
// ====================================================================

/**
 * Récupère toutes les données (chambres, occupants, participants)
 * et les structure pour le frontend
 */
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

// ====================================================================
// ROUTES API - DONNÉES
// ====================================================================

/**
 * GET /api/data
 * Récupère toutes les données de l'application
 */
app.get('/api/data', async (req, res) => {
    try {
        const data = await getAllData();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ====================================================================
// ROUTES API - INSCRIPTION
// ====================================================================

/**
 * POST /api/assign
 * Assigne un groupe de participants à une chambre
 */
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

// ====================================================================
// ROUTES API - MODIFICATION D'INSCRIPTION
// ====================================================================

/**
 * POST /api/modify
 * Permet à un utilisateur de modifier son inscription avec un code
 */
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

// ====================================================================
// ROUTES API - ADMINISTRATION - GESTION DES OCCUPANTS
// ====================================================================

/**
 * POST /api/admin/remove
 * Retire un occupant spécifique d'une chambre (admin)
 */
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

/**
 * POST /api/admin/clear-room
 * Vide complètement une chambre (admin)
 */
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

/**
 * POST /api/admin/toggle-female
 * Active/désactive le mode "femmes uniquement" pour une chambre (admin)
 */
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

// ====================================================================
// ROUTES API - ADMINISTRATION - GESTION DES PARTICIPANTS
// ====================================================================

/**
 * POST /api/admin/upload-participants
 * Importe une liste de participants depuis un fichier CSV (admin)
 */
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

/**
 * POST /api/admin/update-participants
 * Met à jour la liste complète des participants (admin)
 */
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

/**
 * POST /api/admin/edit-participant
 * Modifie le nom d'un participant (admin)
 */
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

/**
 * POST /api/admin/delete-participant
 * Supprime un participant de la liste (admin)
 */
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

/**
 * POST /api/admin/clear-participants
 * Efface toute la liste des participants (admin)
 */
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

// ====================================================================
// ROUTES API - ADMINISTRATION - GESTION DES CHAMBRES
// ====================================================================

/**
 * POST /api/admin/update-rooms
 * Met à jour la configuration des chambres (admin)
 * 
 * IMPORTANT : Cette fonction préserve les occupants lors des changements
 * de numéros de chambres en utilisant une approche de mise à jour plutôt
 * que suppression/recréation
 * 
 * @param {Array} rooms - Nouvelle configuration des chambres
 * @param {Array} roomChanges - Mapping des changements de numéros (optionnel)
 *   Structure: [{ oldId, newId, occupants, genderPreference, userPreference }]
 */
app.post('/api/admin/update-rooms', async (req, res) => {
    try {
        const { rooms, roomChanges, password } = req.body;
        
        if (password !== 'adminlvp25') {
            return res.status(401).json({ error: 'Code admin incorrect' });
        }

        // ====================================================================
        // ÉTAPE 1 : Créer un mapping temporaire pour les changements de numéros
        // ====================================================================
        const roomChangeMap = new Map();
        if (roomChanges && roomChanges.length > 0) {
            console.log('🔄 Changements de numéros détectés:', roomChanges.length);
            roomChanges.forEach(change => {
                roomChangeMap.set(change.oldId, change);
                console.log(`  Prévu: ${change.oldId} → ${change.newId} (${change.occupants.length} occupant(s))`);
            });
        }

        // ====================================================================
        // ÉTAPE 2 : Récupérer les chambres existantes
        // ====================================================================
        const { data: existingRooms } = await supabase
            .from('rooms')
            .select('*');

        const existingRoomIds = new Set(existingRooms.map(r => r.id));
        const newRoomIds = new Set(rooms.map(r => r.id));

        // ====================================================================
        // ÉTAPE 3 : Identifier les chambres à traiter
        // ====================================================================
        
        // Chambres qui existent mais ne sont plus dans la nouvelle config
        // ET qui ne sont pas renommées (pas dans oldId de roomChanges)
        const roomsToDelete = existingRooms.filter(room => {
            const isRenamed = roomChangeMap.has(room.id);
            const existsInNewConfig = newRoomIds.has(room.id);
            return !existsInNewConfig && !isRenamed;
        });

        // Nouvelles chambres qui n'existaient pas
        const roomsToCreate = rooms.filter(room => {
            // C'est une nouvelle chambre si:
            // - Son ID n'existait pas avant
            // - ET ce n'est pas le résultat d'un renommage (pas dans newId de roomChanges)
            const isNewFromRename = Array.from(roomChangeMap.values()).some(c => c.newId === room.id);
            return !existingRoomIds.has(room.id) && !isNewFromRename;
        });

        // Chambres à mettre à jour (existent déjà et sont dans la nouvelle config)
        const roomsToUpdate = rooms.filter(room => existingRoomIds.has(room.id));

        console.log(`📊 Analyse: ${roomsToDelete.length} à supprimer, ${roomsToCreate.length} à créer, ${roomsToUpdate.length} à mettre à jour`);

        // ====================================================================
        // ÉTAPE 4 : Traiter les changements de numéros EN PREMIER
        // ====================================================================
        if (roomChanges && roomChanges.length > 0) {
            for (const change of roomChanges) {
                console.log(`🔄 Renommage: ${change.oldId} → ${change.newId}`);
                
                // 4.1 : Créer la nouvelle chambre avec le nouveau ID
                const newRoom = rooms.find(r => r.id === change.newId);
                if (newRoom) {
                    await supabase
                        .from('rooms')
                        .insert({
                            id: newRoom.id,
                            capacity: newRoom.capacity,
                            type: newRoom.type,
                            is_female_only: false,
                            gender_preference: change.genderPreference || 'mixed',
                            user_preference: change.userPreference || false
                        });
                    console.log(`  ✓ Nouvelle chambre ${newRoom.id} créée`);
                }
                
                // 4.2 : Migrer les occupants vers le nouveau ID
                await supabase
                    .from('occupants')
                    .update({ room_id: change.newId })
                    .eq('room_id', change.oldId);
                console.log(`  ✓ Occupants migrés vers ${change.newId}`);
                
                // 4.3 : Supprimer l'ancienne chambre (maintenant vide)
                await supabase
                    .from('rooms')
                    .delete()
                    .eq('id', change.oldId);
                console.log(`  ✓ Ancienne chambre ${change.oldId} supprimée`);
            }
        }

        // ====================================================================
        // ÉTAPE 5 : Supprimer les chambres obsolètes (sans occupants ou vidées avant)
        // ====================================================================
        if (roomsToDelete.length > 0) {
            for (const room of roomsToDelete) {
                // Vérifier d'abord s'il y a des occupants
                const { data: occupants } = await supabase
                    .from('occupants')
                    .select('id')
                    .eq('room_id', room.id);
                
                if (occupants && occupants.length > 0) {
                    console.log(`⚠️  Chambre ${room.id} a ${occupants.length} occupant(s) - suppression des occupants d'abord`);
                    await supabase
                        .from('occupants')
                        .delete()
                        .eq('room_id', room.id);
                }
                
                await supabase
                    .from('rooms')
                    .delete()
                    .eq('id', room.id);
                console.log(`  🗑️  Chambre ${room.id} supprimée`);
            }
        }

        // ====================================================================
        // ÉTAPE 6 : Créer les nouvelles chambres
        // ====================================================================
        if (roomsToCreate.length > 0) {
            const roomsToInsert = roomsToCreate.map(room => ({
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

            if (insertError) {
                console.error('❌ Erreur création chambres:', insertError);
                throw insertError;
            }
            console.log(`  ➕ ${roomsToCreate.length} nouvelle(s) chambre(s) créée(s)`);
        }

        // ====================================================================
        // ÉTAPE 7 : Mettre à jour les chambres existantes
        // ====================================================================
        if (roomsToUpdate.length > 0) {
            for (const room of roomsToUpdate) {
                // Récupérer la préférence de genre actuelle si la chambre a des occupants
                const { data: occupants } = await supabase
                    .from('occupants')
                    .select('id')
                    .eq('room_id', room.id);
                
                const { data: currentRoom } = await supabase
                    .from('rooms')
                    .select('gender_preference, user_preference')
                    .eq('id', room.id)
                    .single();
                
                // Conserver la préférence si la chambre a des occupants, sinon réinitialiser
                const genderPreference = (occupants && occupants.length > 0) 
                    ? (currentRoom?.gender_preference || 'mixed')
                    : 'mixed';
                const userPreference = (occupants && occupants.length > 0)
                    ? (currentRoom?.user_preference || false)
                    : false;
                
                await supabase
                    .from('rooms')
                    .update({
                        capacity: room.capacity,
                        type: room.type,
                        gender_preference: genderPreference,
                        user_preference: userPreference
                    })
                    .eq('id', room.id);
            }
            console.log(`  🔄 ${roomsToUpdate.length} chambre(s) mise(s) à jour`);
        }

        const data = await getAllData();
        
        console.log('✅ Configuration des chambres mise à jour avec succès');
        if (roomChanges && roomChanges.length > 0) {
            console.log(`   ${roomChanges.length} chambre(s) renumérée(s) avec occupants préservés`);
        }
        
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ Erreur lors de la mise à jour des chambres:', error);
        res.status(500).json({ error: error.message });
    }
});

// ====================================================================
// ROUTES API - ADMINISTRATION - RÉINITIALISATION
// ====================================================================

/**
 * POST /api/admin/reset
 * Réinitialise complètement l'application (admin)
 * Supprime tous les occupants et participants, réinitialise les chambres
 */
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

// ====================================================================
// DÉMARRAGE DU SERVEUR
// ====================================================================

app.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 Serveur démarré avec succès');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🔗 Supabase URL: ${SUPABASE_URL}`);
    console.log('========================================');
});
