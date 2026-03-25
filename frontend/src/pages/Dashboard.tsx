import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { Plus, LogOut, User, Trash2, CheckSquare, Square, Edit2, Tag } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, clearLocalData, type Task as DbTask } from '../db';
import { syncData, initSyncEngine } from '../sync';

export default function Dashboard() {
    const navigate = useNavigate();
    const tasks = useLiveQuery(() => db.tasks.toArray()) || [];
    const tags = useLiveQuery(() => db.tags.toArray()) || [];
    const [filterTag, setFilterTag] = useState<number | string | ''>('');
    const [isVerified, setIsVerified] = useState<boolean>(true);
    const [verificationCode, setVerificationCode] = useState('');
    const [userEmail, setUserEmail] = useState('');

    const [showTaskModal, setShowTaskModal] = useState(false);
    const [showTagModal, setShowTagModal] = useState(false);

    // Task form
    const [editingTaskId, setEditingTaskId] = useState<number | string | null>(null);
    const [taskTitle, setTaskTitle] = useState('');
    const [taskDesc, setTaskDesc] = useState('');
    const [taskDue, setTaskDue] = useState('');
    const [taskTag, setTaskTag] = useState<number | string>('');

    // Tag Form
    const [newTagTitle, setNewTagTitle] = useState('');
    const [newTagColor, setNewTagColor] = useState('#0ea5e9');

    const BASIC_COLORS = [
        '#ef4444', '#f97316', '#f59e0b', '#eab308',
        '#84cc16', '#22c55e', '#10b981', '#14b8a6',
        '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
        '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
    ];

    const loadData = async () => {
        try {
            const [p] = await Promise.all([
                fetchWithAuth('/me')
            ]);
            setIsVerified(p.is_verified);
            setUserEmail(p.primary_mail);
        } catch (err) { }
    };

    useEffect(() => {
        initSyncEngine();
        loadData();
        syncData(); // Trigger initial sync
    }, []);

    const handleLogout = async () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userSalt');
        localStorage.removeItem('sessionPepper');
        await clearLocalData();
        navigate('/login');
    };

    const handleSaveTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!taskTitle || !taskTag) {
            toast.error('Title and Tag are required');
            return;
        }
        try {
            const ts = Date.now();
            const tagObj = tags.find(t => t.id == taskTag);
            if (editingTaskId) {
                const updatedTask = {
                    title: taskTitle,
                    description: taskDesc,
                    due_date: taskDue,
                    tag_id: taskTag,
                    tag_title: tagObj?.title,
                    tag_color: tagObj?.color,
                    state: tasks.find(t => t.id === editingTaskId)?.state || 'new',
                    updated_at: ts
                };
                await db.tasks.update(editingTaskId, updatedTask);
                await db.mutations.add({
                    type: 'task_update', target_id: editingTaskId, data: { ...updatedTask, dueDate: taskDue, tagId: taskTag }, timestamp: ts
                });
                toast.success('Task updated locally');
            } else {
                const tempId = 'temp_' + ts;
                const newTask = {
                    id: tempId,
                    title: taskTitle,
                    description: taskDesc,
                    due_date: taskDue,
                    tag_id: taskTag,
                    tag_title: tagObj?.title,
                    tag_color: tagObj?.color,
                    state: 'new',
                    updated_at: ts,
                    deleted_at: 0
                };
                await db.tasks.put(newTask);
                await db.mutations.add({
                    type: 'task_create', local_id: tempId, data: { ...newTask, dueDate: taskDue, tagId: taskTag }, timestamp: ts
                });
                toast.success('Task created locally');
            }
            setShowTaskModal(false);
            syncData();
        } catch (err: any) {
            toast.error('Failed to save task locally');
        }
    };

    const handleToggleState = async (task: DbTask) => {
        const newState = task.state === 'finished' ? 'new' : 'finished';
        try {
            const ts = Date.now();
            const updated = { ...task, state: newState, updated_at: ts };
            await db.tasks.update(task.id, updated);
            await db.mutations.add({
                type: 'task_update', target_id: task.id, data: { ...updated, dueDate: updated.due_date, tagId: updated.tag_id }, timestamp: ts
            });
            syncData();
        } catch (err) { }
    };

    const handleDeleteTask = async (id: number | string) => {
        if (!window.confirm('Delete this task?')) return;
        try {
            const ts = Date.now();
            await db.tasks.delete(id);
            await db.mutations.add({ type: 'task_delete', target_id: id, timestamp: ts });
            toast.success('Task deleted locally');
            syncData();
        } catch (err) { }
    };

    const handleCreateTag = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const ts = Date.now();
            const tempId = 'temp_' + ts;
            await db.tags.put({ id: tempId, title: newTagTitle, color: newTagColor, updated_at: ts, deleted_at: 0 });
            await db.mutations.add({ type: 'tag_create', local_id: tempId, data: { title: newTagTitle, color: newTagColor }, timestamp: ts });

            toast.success('Tag created locally');
            setNewTagTitle('');
            setShowTagModal(false);
            syncData();
        } catch (err) {
            toast.error('Failed to create tag locally');
        }
    };

    const handleDeleteTag = async (id: number | string) => {
        if (!window.confirm('Delete this tag? All associated tasks will be lost.')) return;
        try {
            const ts = Date.now();
            await db.tags.delete(id);
            await db.mutations.add({ type: 'tag_delete', target_id: id, timestamp: ts });

            // cascades to local tasks
            const localTasks = await db.tasks.where('tag_id').equals(id).toArray();
            for (const t of localTasks) {
                await db.tasks.delete(t.id);
                await db.mutations.add({ type: 'task_delete', target_id: t.id, timestamp: ts });
            }

            toast.success('Tag deleted locally');
            syncData();
        } catch (err: any) { }
    };

    const openNewTaskModal = () => {
        setEditingTaskId(null);
        setTaskTitle('');
        setTaskDesc('');
        setTaskDue('');
        setTaskTag(tags[0]?.id || '');
        setShowTaskModal(true);
    };

    const openEditTaskModal = (t: DbTask) => {
        setEditingTaskId(t.id);
        setTaskTitle(t.title);
        setTaskDesc(t.description || '');
        setTaskDue(t.due_date || '');
        setTaskTag(t.tag_id);
        setShowTaskModal(true);
    };

    const handleVerifyEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetchWithAuth('/verify-email', {
                method: 'POST',
                body: JSON.stringify({ email: userEmail, code: verificationCode })
            });
            toast.success('Email successfully verified!');
            loadData();
        } catch (err: any) {
            toast.error(err.message || 'Verification failed');
        }
    };

    const filteredTasks = tasks.filter(t =>
        (filterTag ? t.tag_id === filterTag : true) && t.state !== 'finished'
    );

    return (
        <div className="app-container">
            <nav className="navbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>✓</div>
                    <h2 style={{ margin: 0 }}>Online ToDo</h2>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <Link to="/profile" className="btn btn-outline"><User size={18} /> Profile</Link>
                    <button className="btn btn-danger" onClick={handleLogout}><LogOut size={18} /> Logout</button>
                </div>
            </nav>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <select className="input-field" style={{ margin: 0, width: '200px' }} value={filterTag} onChange={e => setFilterTag(e.target.value ? (e.target.value.startsWith('temp_') ? e.target.value : Number(e.target.value)) : '')}>
                        <option value="">All Tags</option>
                        {tags.map(tag => (
                            <option key={tag.id} value={tag.id}>{tag.title}</option>
                        ))}
                    </select>
                    <button className="btn btn-outline" onClick={() => setShowTagModal(true)}>
                        <Tag size={18} /> Manage Tags
                    </button>
                </div>

                <button className="btn btn-primary" onClick={openNewTaskModal} disabled={!isVerified}>
                    <Plus size={18} /> New Task
                </button>
            </div>

            {!isVerified && (
                <div className="glass-panel animate-slide-in" style={{ marginBottom: '2rem', border: '1px solid var(--danger)', background: 'rgba(239, 68, 68, 0.05)' }}>
                    <h3 style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>Account Verification Required</h3>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                        We've sent a 6-digit verification code to <strong>{userEmail}</strong>. You must verify your email to create tasks. Unverified accounts are deleted after 1 week.
                    </p>
                    <form onSubmit={handleVerifyEmail} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <input
                            type="text"
                            className="input-field"
                            style={{ margin: 0, maxWidth: '200px' }}
                            placeholder="6-digit code"
                            value={verificationCode}
                            onChange={e => setVerificationCode(e.target.value)}
                            required
                        />
                        <button type="submit" className="btn btn-danger" style={{ height: '100%' }}>Verify Mail</button>
                    </form>
                </div>
            )}

            <div className="glass-panel animate-slide-in">
                <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                    {filterTag ? `Tasks for ${tags.find(t => t.id === filterTag)?.title}` : 'All Unfinished Tasks'}
                </h3>

                {filteredTasks.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <p>You have no unfinished tasks. You are all caught up!</p>
                    </div>
                ) : (
                    <div className="task-list">
                        {filteredTasks.map(task => (
                            <div key={task.id} className="task-item">
                                <div className="task-header">
                                    <div className="task-title">
                                        <button
                                            onClick={() => handleToggleState(task)}
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                                        >
                                            {task.state === 'finished' ? <CheckSquare size={20} color="var(--success)" /> : <Square size={20} />}
                                        </button>
                                        <span style={{ textDecoration: task.state === 'finished' ? 'line-through' : 'none', color: task.state === 'finished' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                            {task.title}
                                        </span>
                                        <span className="tag-badge" style={{ backgroundColor: task.tag_color }}>
                                            {task.tag_title}
                                        </span>
                                        {task.due_date && (
                                            <span style={{ fontSize: '0.8rem', color: 'var(--danger)', border: '1px solid currentColor', borderRadius: '4px', padding: '0 4px' }}>
                                                Due: {new Date(task.due_date).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openEditTaskModal(task)}><Edit2 size={16} /></button>
                                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDeleteTask(task.id)}><Trash2 size={16} /></button>
                                    </div>
                                </div>
                                {task.description && (
                                    <div className="task-desc" style={{ marginLeft: '28px' }}>
                                        {task.description}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* MODALS */}
            {showTaskModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
                    <div className="glass-panel animate-slide-in" style={{ width: '100%', maxWidth: '500px', background: 'var(--bg-color)' }}>
                        <h2 style={{ marginBottom: '1.5rem' }}>{editingTaskId ? 'Edit Task' : 'New Task'}</h2>
                        <form onSubmit={handleSaveTask} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <input type="text" className="input-field" placeholder="Task Title" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} required />
                            <textarea className="input-field" placeholder="Description (Optional)" value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={3} />
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <input type="date" className="input-field" value={taskDue} onChange={e => setTaskDue(e.target.value)} />
                                <select className="input-field" value={taskTag} onChange={e => setTaskTag(e.target.value.startsWith('temp_') ? e.target.value : Number(e.target.value))} required>
                                    <option value="" disabled>Select Tag</option>
                                    {tags.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button type="button" className="btn btn-outline" onClick={() => setShowTaskModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Task</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showTagModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
                    <div className="glass-panel animate-slide-in" style={{ width: '100%', maxWidth: '500px', background: 'var(--bg-color)', maxHeight: '90vh', overflowY: 'auto' }}>
                        <h2 style={{ marginBottom: '1.5rem' }}>Manage Tags</h2>

                        <form onSubmit={handleCreateTag} style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', alignItems: 'center' }}>
                            <input type="text" className="input-field" style={{ margin: 0, flex: 1 }} placeholder="New Tag Name" maxLength={64} value={newTagTitle} onChange={e => setNewTagTitle(e.target.value)} required />
                            <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} style={{ width: '40px', height: '40px', padding: '0', border: 'none', borderRadius: '8px', cursor: 'pointer' }} />
                            <button type="submit" className="btn btn-primary"><Plus size={18} /></button>
                        </form>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
                            {BASIC_COLORS.map(c => (
                                <div key={c} onClick={() => setNewTagColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: newTagColor === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} />
                            ))}
                        </div>

                        <div className="task-list">
                            {tags.map(tag => (
                                <div key={tag.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ width: 16, height: 16, borderRadius: '50%', background: tag.color }} />
                                        <span style={{ fontWeight: 600 }}>{tag.title}</span>
                                    </div>
                                    <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDeleteTag(tag.id)}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
                            <button className="btn btn-outline" onClick={() => setShowTagModal(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
