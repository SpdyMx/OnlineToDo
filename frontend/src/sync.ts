import { db } from './db';
import { fetchWithAuth } from './api';

export const syncData = async () => {
    // Check if network is theoretically online
    if (!navigator.onLine) return false;

    try {
        const appState = await db.appState.get('sync_state');
        const lastSync = appState ? appState.lastSync : 0;

        // Get all pending mutations
        const mutations = await db.mutations.orderBy('timestamp').toArray();

        // format mutations
        const payloadMutations = mutations.map(m => {
            if (m.type === 'task_create') {
                return { type: m.type, local_id: m.local_id, data: m.data, timestamp: m.timestamp };
            }
            if (m.type === 'task_update' || m.type === 'task_delete' || m.type === 'tag_delete') {
                return { type: m.type, id: m.target_id, data: m.data, timestamp: m.timestamp };
            }
            if (m.type === 'tag_create') {
                return { type: m.type, local_id: m.local_id, data: m.data, timestamp: m.timestamp };
            }
            return null;
        }).filter(Boolean);

        const response = await fetchWithAuth('/sync', {
            method: 'POST',
            body: JSON.stringify({ lastSync, mutations: payloadMutations })
        });

        const { success, serverTime, tasks, tags } = response;

        if (success) {
            // Apply incoming tags
            for (const t of tags) {
                if (t.deleted_at > 0) {
                    await db.tags.delete(t.id);
                } else {
                    await db.tags.put(t);
                }
            }

            // Apply incoming tasks
            for (const t of tasks) {
                if (t.deleted_at > 0) {
                    await db.tasks.delete(t.id);
                } else {
                    await db.tasks.put(t);
                }
            }

            // Clean up flushed mutations
            if (mutations.length > 0) {
                const mutationIds = mutations.map(m => m.id!);
                await db.mutations.bulkDelete(mutationIds);

                // Remove local temp items since the server just echoed back the real persistent ones
                for (const m of mutations) {
                    if (m.type === 'task_create' && m.local_id) {
                        await db.tasks.delete(m.local_id);
                    }
                    if (m.type === 'tag_create' && m.local_id) {
                        await db.tags.delete(m.local_id);
                    }
                }
            }

            // Update sync timestamp
            await db.appState.put({ id: 'sync_state', lastSync: serverTime });
            return true;
        }
    } catch (err) {
        console.error('Background Sync Failed:', err);
    }
    return false;
};

// Start background sync listener
export const initSyncEngine = () => {
    window.addEventListener('online', () => {
        syncData();
    });
};
