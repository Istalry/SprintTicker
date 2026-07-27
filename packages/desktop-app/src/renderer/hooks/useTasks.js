import { useState, useEffect } from 'react';
/**
 * Custom React hook fetching projects and tasks with support for fuzzy filtering.
 */
export function useTasks(selectedProjectId = 'PROJ') {
    const [projects] = useState([
        { id: 'PROJ', key: 'PROJ', name: 'Core Gameplay Engine' },
        { id: 'UI', key: 'UI', name: 'Main Menu & HUD Redesign' },
        { id: 'SHDR', key: 'SHDR', name: 'Custom Shader Pipeline' }
    ]);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.getTasks(selectedProjectId).then(taskList => {
                if (taskList && taskList.length > 0) {
                    setTasks(taskList);
                }
                else {
                    // Default initial tasks if empty
                    setTasks([
                        { id: 'PROJ-142', projectId: 'PROJ', key: 'PROJ-142', title: 'Implement Player Character Dash Mechanics', status: 'in_progress' },
                        { id: 'PROJ-145', projectId: 'PROJ', key: 'PROJ-145', title: 'Fix RigidBody Collision Jitter on Slope', status: 'todo' },
                        { id: 'PROJ-149', projectId: 'PROJ', key: 'PROJ-149', title: 'Add Audio Fmod Hooks for Footsteps', status: 'todo' }
                    ]);
                }
                setLoading(false);
            }).catch(err => {
                console.error('[useTasks] Error fetching tasks:', err);
                setLoading(false);
            });
        }
        else {
            setLoading(false);
        }
    }, [selectedProjectId]);
    return {
        projects,
        tasks,
        loading
    };
}
//# sourceMappingURL=useTasks.js.map