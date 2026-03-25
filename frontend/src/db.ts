import Dexie, { type Table } from 'dexie';

export interface Task {
    id: number | string; // string for local pending ids -> 'temp_xyz'
    title: string;
    description: string | null;
    due_date: string | null;
    state: string;
    tag_id: number | string;
    tag_title?: string;
    tag_color?: string;
    updated_at: number;
    deleted_at: number;
}

export interface Tag {
    id: number | string;
    title: string;
    color: string;
    updated_at: number;
    deleted_at: number;
}

export interface Mutation {
    id?: number;
    type: 'task_create' | 'task_update' | 'task_delete' | 'tag_create' | 'tag_delete';
    local_id?: string | number;
    target_id?: string | number;
    data?: any;
    timestamp: number;
}

export interface AppState {
    id: string; // usually 'sync_state'
    lastSync: number;
}

export class AppDatabase extends Dexie {
    tasks!: Table<Task>;
    tags!: Table<Tag>;
    mutations!: Table<Mutation>;
    appState!: Table<AppState>;

    constructor() {
        super('OnlineToDoDB');
        this.version(1).stores({
            tasks: 'id, tag_id, state, updated_at', // primary key and indexed props
            tags: 'id, updated_at',
            mutations: '++id, timestamp', // auto-increment primary key
            appState: 'id'
        });
    }
}

export const db = new AppDatabase();

// Clear DB on logout
export const clearLocalData = async () => {
    await db.tasks.clear();
    await db.tags.clear();
    await db.mutations.clear();
    await db.appState.clear();
};
