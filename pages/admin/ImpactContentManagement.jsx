import React, { useState, useEffect, useRef } from 'react';
import supabase, { SUPABASE_AUTH_KEY } from '../../utils/supabaseClient';
import { toast } from 'react-toastify';

function ImpactContentManagement() {
    const [activeTab, setActiveTab] = useState('testimonials');
    const [stories, setStories] = useState([]);
    const [gallery, setGallery] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingItem, setEditingItem] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef(null);

    // Upload image to Supabase Storage
    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            toast.error('Only JPEG, PNG, WebP, and GIF images are allowed');
            return;
        }

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be under 5MB');
            return;
        }

        setUploading(true);
        try {
            // Generate unique file name
            const ext = file.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
            const filePath = `${activeTab}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('impact-images')
                .upload(filePath, file, { cacheControl: '3600', upsert: false });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('impact-images')
                .getPublicUrl(filePath);

            setEditingItem({ ...editingItem, image_url: publicUrl });
            toast.success('Image uploaded successfully!');
        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Failed to upload image: ' + (error.message || 'Unknown error'));
        } finally {
            setUploading(false);
            // Reset file input so the same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Map tab to story type for the 3 story tabs
    const tabToStoryType = {
        'testimonials': 'testimonial',
        'blog': 'featured',
        'news': 'news'
    };

    // Tab display labels
    const tabLabels = {
        'testimonials': 'Testimonials',
        'blog': 'Blog',
        'news': 'News/Updates',
        'gallery': 'Gallery',
        'recipes': 'Recipes'
    };

    // Helper: is this a story-type tab?
    const isStoryTab = (tab) => ['testimonials', 'blog', 'news'].includes(tab);

    // Filter stories by type for the active tab
    const getFilteredStories = (tab) => {
        const type = tabToStoryType[tab];
        return stories.filter(s => s.type === type);
    };

    useEffect(() => {
        loadAllData();
    }, []);

    const loadAllData = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            // Get token from localStorage directly (avoids getSession() which can hang)
            let accessToken = supabaseKey;
            try {
                const sessionData = JSON.parse(localStorage.getItem(SUPABASE_AUTH_KEY) || '{}');
                if (sessionData?.access_token) {
                    accessToken = sessionData.access_token;
                }
            } catch (e) {
                console.warn('[ImpactCMS] loadAllData: Failed to read localStorage token');
            }

            const headers = {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${accessToken}`,
            };

            const [storiesRes, galleryRes, recipesRes] = await Promise.all([
                fetch(`${supabaseUrl}/rest/v1/impact_stories?order=display_order`, { headers }),
                fetch(`${supabaseUrl}/rest/v1/impact_gallery?order=display_order`, { headers }),
                fetch(`${supabaseUrl}/rest/v1/impact_recipes?order=display_order`, { headers })
            ]);

            if (!storiesRes.ok) throw new Error('Failed to load stories');
            if (!galleryRes.ok) throw new Error('Failed to load gallery');
            if (!recipesRes.ok) throw new Error('Failed to load recipes');

            const [storiesData, galleryData, recipesData] = await Promise.all([
                storiesRes.json(),
                galleryRes.json(),
                recipesRes.json()
            ]);

            setStories(storiesData || []);
            setGallery(galleryData || []);
            setRecipes(recipesData || []);
        } catch (error) {
            console.error('Error loading data:', error);
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        const newItem = getEmptyItem();
        setEditingItem(newItem);
        setShowModal(true);
        
    };

    const handleEdit = (item) => {
        setEditingItem({ ...item });
        setShowModal(true);
    };

    // Helper for direct REST API calls (bypasses hanging Supabase JS client)
    const supabaseRest = async (table, method, body = null, filter = '') => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        // Get token from localStorage directly (avoids getSession() which can hang)
        let accessToken = supabaseKey;
        try {
            const sessionData = JSON.parse(localStorage.getItem(SUPABASE_AUTH_KEY) || '{}');
            if (sessionData?.access_token) {
                accessToken = sessionData.access_token;
                console.log('[ImpactCMS] Using token from localStorage');
            } else {
                console.log('[ImpactCMS] No localStorage token, using anon key');
            }
        } catch (e) {
            console.warn('[ImpactCMS] Failed to read localStorage token:', e);
        }

        const url = `${supabaseUrl}/rest/v1/${table}${filter ? '?' + filter : ''}`;
        const headers = {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${accessToken}`,
            'Prefer': 'return=minimal'
        };

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        console.log('[ImpactCMS] REST API call:', method, url);

        // Add timeout to prevent hanging
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        opts.signal = controller.signal;

        try {
            const response = await fetch(url, opts);
            clearTimeout(timeout);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`${method} ${table} failed: ${response.status} - ${errText}`);
            }
            console.log('[ImpactCMS] REST API success:', method, table, response.status);
            return response;
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') {
                throw new Error(`${method} ${table} timed out after 15 seconds`);
            }
            throw err;
        }
    };

    const handleDelete = async (id, table) => {
        if (!confirm('Are you sure you want to delete this item?')) return;
        
        try {
            await supabaseRest(table, 'DELETE', null, `id=eq.${id}`);
            toast.success('Item deleted successfully');
            loadAllData(true);
        } catch (error) {
            console.error('Error deleting:', error);
            toast.error('Failed to delete item');
        }
    };

    const handleSave = async () => {
        if (saving) {
            console.log('[ImpactCMS] Already saving, ignoring click');
            return;
        }
        
        console.log('[ImpactCMS] handleSave called - activeTab:', activeTab, 'editingItem:', editingItem);
        
        // Validate required fields
        if (!editingItem?.title?.trim()) {
            toast.error('Title is required');
            return;
        }
        if (isStoryTab(activeTab) && !editingItem?.quote?.trim()) {
            toast.error('Quote/Content is required');
            return;
        }
        if (activeTab === 'gallery' && !editingItem?.image_url?.trim()) {
            toast.error('Image URL is required for gallery items');
            return;
        }
        if (activeTab === 'recipes' && !editingItem?.youtube_url?.trim()) {
            console.log('[ImpactCMS] Validation failed - youtube_url missing');
            toast.error('YouTube URL is required for recipes');
            return;
        }

        setSaving(true);
        try {
            const table = getTableName();
            // eslint-disable-next-line no-unused-vars
            const { id, created_at, updated_at, created_by, ...itemData } = editingItem;
            
            console.log('[ImpactCMS] Saving to table:', table, 'id:', id, 'data:', itemData);

            if (id) {
                // Update existing via REST API
                console.log('[ImpactCMS] Updating item via REST API');
                const updateData = { ...itemData, updated_at: new Date().toISOString() };
                await supabaseRest(table, 'PATCH', updateData, `id=eq.${id}`);
                console.log('[ImpactCMS] Update successful');
                toast.success('Item updated successfully');
            } else {
                // Create new via REST API
                console.log('[ImpactCMS] Creating new item via REST API');
                await supabaseRest(table, 'POST', itemData);
                console.log('[ImpactCMS] Insert successful');
                toast.success('Item created successfully');
            }
            
            setShowModal(false);
            setEditingItem(null);
            await loadAllData(true);
        } catch (error) {
            console.error('[ImpactCMS] Error saving - Full error:', error);
            console.error('[ImpactCMS] Error message:', error.message);
            console.error('[ImpactCMS] Error code:', error.code);
            console.error('[ImpactCMS] Error details:', error.details);
            console.error('[ImpactCMS] Error hint:', error.hint);
            toast.error('Failed to save: ' + (error.message || error.code || 'Unknown error'));
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (id, isActive, table) => {
        try {
            await supabaseRest(table, 'PATCH', { is_active: !isActive }, `id=eq.${id}`);
            toast.success(isActive ? 'Item hidden' : 'Item activated');
            loadAllData(true);
        } catch (error) {
            console.error('Error toggling active:', error);
            toast.error('Failed to update status');
        }
    };

    const getTableName = () => {
        if (isStoryTab(activeTab)) return 'impact_stories';
        if (activeTab === 'recipes') return 'impact_recipes';
        return 'impact_gallery';
    };

    const getNextDisplayOrder = () => {
        if (isStoryTab(activeTab)) {
            const filtered = getFilteredStories(activeTab);
            if (filtered.length === 0) return 1;
            return Math.max(...filtered.map(s => s.display_order || 0)) + 1;
        } else if (activeTab === 'recipes') {
            if (recipes.length === 0) return 1;
            return Math.max(...recipes.map(r => r.display_order || 0)) + 1;
        } else {
            if (gallery.length === 0) return 1;
            return Math.max(...gallery.map(g => g.display_order || 0)) + 1;
        }
    };

    const getEmptyItem = () => {
        const nextOrder = getNextDisplayOrder();
        if (isStoryTab(activeTab)) {
            const base = {
                type: tabToStoryType[activeTab],
                title: '',
                quote: '',
                display_order: nextOrder,
                is_active: true
            };
            if (activeTab !== 'testimonials') {
                base.image_url = '';
            }
            return base;
        } else if (activeTab === 'recipes') {
            return {
                title: '',
                description: '',
                youtube_url: '',
                thumbnail_url: '',
                display_order: nextOrder,
                is_active: true
            };
        } else {
            return {
                title: '',
                description: '',
                image_url: '',
                display_order: nextOrder,
                is_active: true
            };
        }
    };

    const renderStoryForm = () => (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <div className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-700">
                    {tabLabels[activeTab]}
                </div>
                <input type="hidden" value={editingItem?.type || tabToStoryType[activeTab]} />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                    type="text"
                    value={editingItem?.title || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quote/Content</label>
                <textarea
                    value={editingItem?.quote || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, quote: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border rounded-lg"
                />
            </div>
            {activeTab !== 'testimonials' && (
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Image</label>
                
                {/* Upload button */}
                <div className="flex items-center gap-3 mb-3">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleImageUpload}
                        className="hidden"
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {uploading ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                Uploading...
                            </>
                        ) : (
                            <>📷 Upload Image</>
                        )}
                    </button>
                    <span className="text-xs text-gray-500">Max 5MB — JPEG, PNG, WebP, GIF</span>
                </div>

                {/* Or paste URL */}
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400">— or paste a direct image URL —</span>
                </div>
                <input
                    type="text"
                    value={editingItem?.image_url || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, image_url: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="https://images.unsplash.com/photo-..."
                />

                {/* Preview */}
                {editingItem?.image_url && (
                    <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-1">Preview:</p>
                        <img
                            src={editingItem.image_url}
                            alt="Preview"
                            className="w-40 h-28 object-cover rounded border"
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                        />
                        <p className="text-xs text-red-500 mt-1" style={{ display: 'none' }}>⚠️ Image failed to load — use the Upload button instead.</p>
                    </div>
                )}
            </div>
            )}
            <div className="flex items-center gap-2 pt-2">
                <input
                    type="checkbox"
                    checked={editingItem?.is_active || false}
                    onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked })}
                    className="mr-1"
                />
                <label className="text-sm font-medium text-gray-700">Active</label>
            </div>
        </div>
    );

    const renderGalleryForm = () => (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                    type="text"
                    value={editingItem?.title || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                    value={editingItem?.description || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Image</label>
                
                {/* Upload button */}
                <div className="flex items-center gap-3 mb-3">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleImageUpload}
                        className="hidden"
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {uploading ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                Uploading...
                            </>
                        ) : (
                            <>📷 Upload Image</>
                        )}
                    </button>
                    <span className="text-xs text-gray-500">Max 5MB — JPEG, PNG, WebP, GIF</span>
                </div>

                {/* Or paste URL */}
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400">— or paste a direct image URL —</span>
                </div>
                <input
                    type="text"
                    value={editingItem?.image_url || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, image_url: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="https://images.unsplash.com/photo-..."
                />

                {/* Preview */}
                {editingItem?.image_url && (
                    <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-1">Preview:</p>
                        <img
                            src={editingItem.image_url}
                            alt="Preview"
                            className="w-40 h-28 object-cover rounded border"
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                        />
                        <p className="text-xs text-red-500 mt-1" style={{ display: 'none' }}>⚠️ Image failed to load — use the Upload button instead.</p>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2 pt-2">
                <input
                    type="checkbox"
                    checked={editingItem?.is_active || false}
                    onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked })}
                    className="mr-1"
                />
                <label className="text-sm font-medium text-gray-700">Active</label>
            </div>
        </div>
    );

    // Helper to extract YouTube video ID
    const getYouTubeId = (url) => {
        if (!url) return null;
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([^?&/#]+)/);
        return match ? match[1] : null;
    };

    // Helper to extract clean YouTube URL from various formats (embed code, shortened URL, etc.)
    const cleanYouTubeUrl = (input) => {
        if (!input) return '';
        
        // If it's an iframe embed code, extract the src URL
        const iframeMatch = input.match(/src=["']([^"']+)["']/);
        if (iframeMatch) {
            input = iframeMatch[1];
        }
        
        // Extract video ID
        const videoId = getYouTubeId(input);
        if (!videoId) return input; // Return as-is if we can't parse it
        
        // Return clean watch URL
        return `https://www.youtube.com/watch?v=${videoId}`;
    };

    const renderRecipeForm = () => (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                    type="text"
                    value={editingItem?.title || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="e.g. Easy Community Garden Salad"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                    value={editingItem?.description || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="A short description of this recipe..."
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">YouTube URL *</label>
                <input
                    type="text"
                    value={editingItem?.youtube_url || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, youtube_url: e.target.value })}
                    onBlur={(e) => {
                        // Clean up the URL when user finishes typing
                        const cleaned = cleanYouTubeUrl(e.target.value);
                        if (cleaned !== e.target.value) {
                            setEditingItem({ ...editingItem, youtube_url: cleaned });
                        }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="https://www.youtube.com/watch?v=... or paste embed code"
                />
                {editingItem?.youtube_url && getYouTubeId(editingItem.youtube_url) && (
                    <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-1">Preview:</p>
                        <div className="aspect-video w-full max-w-sm rounded-lg overflow-hidden border">
                            <iframe
                                src={`https://www.youtube.com/embed/${getYouTubeId(editingItem.youtube_url)}`}
                                className="w-full h-full"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                title="YouTube preview"
                            />
                        </div>
                    </div>
                )}
                {editingItem?.youtube_url && !getYouTubeId(editingItem.youtube_url) && (
                    <p className="text-xs text-red-500 mt-1">⚠️ Could not parse YouTube URL. Use a standard youtube.com/watch?v= or youtu.be/ link.</p>
                )}
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Custom Thumbnail URL (optional)</label>
                <input
                    type="text"
                    value={editingItem?.thumbnail_url || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, thumbnail_url: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="Leave blank to use YouTube thumbnail"
                />
            </div>
            <div className="flex items-center gap-2 pt-2">
                <input
                    type="checkbox"
                    checked={editingItem?.is_active || false}
                    onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked })}
                    className="mr-1"
                />
                <label className="text-sm font-medium text-gray-700">Active</label>
            </div>
        </div>
    );

    return (
        <div className="-mx-6 md:-mx-10 -my-6 md:-my-10 min-h-screen bg-gray-50">
            <div className="bg-white border-b px-6 py-6">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">Impact Content Management</h1>
                <p className="text-gray-500 text-sm">Create and manage testimonials, blog posts, news, gallery, and recipes</p>
            </div>

            {/* Tabs */}
            <div className="bg-white border-b px-6 flex flex-wrap gap-1 sticky top-16 z-30">
                {['testimonials', 'blog', 'news', 'gallery', 'recipes'].map((tab) => {
                    const count = tab === 'gallery' ? gallery.length
                        : tab === 'recipes' ? recipes.length
                        : getFilteredStories(tab).length;
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-3 font-semibold text-sm transition-colors ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
                        >
                            {tabLabels[tab]} ({count})
                        </button>
                    );
                })}
            </div>

            <div className="px-6 py-6">
            {/* Action Button */}
            <button
                onClick={handleCreate}
                className="mb-6 bg-primary-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-primary-700 transition-colors text-sm"
            >
                + Create New {tabLabels[activeTab]} Item
            </button>

            {/* List */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                <div className="grid gap-4">
                    {isStoryTab(activeTab) && getFilteredStories(activeTab).map((story) => (
                        <div key={story.id} className="bg-white p-6 rounded-lg shadow border">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">{tabLabels[activeTab]}</span>
                                        {!story.is_active && <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">Hidden</span>}
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-900 mb-2">{story.title}</h3>
                                    <p className="text-gray-600 mb-2 line-clamp-2">{story.quote}</p>
                                </div>
                                <div className="flex gap-2 ml-4">
                                    <button
                                        onClick={() => toggleActive(story.id, story.is_active, 'impact_stories')}
                                        className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                                    >
                                        {story.is_active ? 'Hide' : 'Show'}
                                    </button>
                                    <button
                                        onClick={() => handleEdit(story)}
                                        className="px-3 py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm text-blue-700"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(story.id, 'impact_stories')}
                                        className="px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-sm text-red-700"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}

                    {activeTab === 'gallery' && gallery.map((item) => (
                        <div key={item.id} className="bg-white p-6 rounded-lg shadow border flex gap-4">
                            <img src={item.image_url} alt={item.title} className="w-32 h-32 object-cover rounded-lg" />
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            {!item.is_active && <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">Hidden</span>}
                                        </div>
                                        <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                                        <p className="text-gray-600">{item.description}</p>
                                    </div>
                                    <div className="flex gap-2 ml-4">
                                        <button
                                            onClick={() => toggleActive(item.id, item.is_active, 'impact_gallery')}
                                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                                        >
                                            {item.is_active ? 'Hide' : 'Show'}
                                        </button>
                                        <button
                                            onClick={() => handleEdit(item)}
                                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm text-blue-700"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(item.id, 'impact_gallery')}
                                            className="px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-sm text-red-700"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {activeTab === 'recipes' && recipes.map((item) => (
                        <div key={item.id} className="bg-white p-6 rounded-lg shadow border flex gap-4">
                            {getYouTubeId(item.youtube_url) && (
                                <img
                                    src={item.thumbnail_url || `https://img.youtube.com/vi/${getYouTubeId(item.youtube_url)}/mqdefault.jpg`}
                                    alt={item.title}
                                    className="w-40 h-24 object-cover rounded-lg"
                                />
                            )}
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">▶ YouTube</span>
                                            {!item.is_active && <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">Hidden</span>}
                                        </div>
                                        <h3 className="text-xl font-bold text-gray-900 mb-1">{item.title}</h3>
                                        {item.description && <p className="text-gray-600 text-sm line-clamp-2">{item.description}</p>}
                                    </div>
                                    <div className="flex gap-2 ml-4">
                                        <button
                                            onClick={() => toggleActive(item.id, item.is_active, 'impact_recipes')}
                                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                                        >
                                            {item.is_active ? 'Hide' : 'Show'}
                                        </button>
                                        <button
                                            onClick={() => handleEdit(item)}
                                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm text-blue-700"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(item.id, 'impact_recipes')}
                                            className="px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-sm text-red-700"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                </div>
            )}
            </div>{/* end px-6 py-6 content wrapper */}

            {/* Modal */}
            {showModal && (
                <div 
                    className="fixed inset-0 bg-black/50 z-[100] flex items-start justify-center pt-20 pb-4 px-4"
                    onClick={() => { setShowModal(false); setEditingItem(null); }}
                >
                    <div 
                        className="bg-white rounded-xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[calc(100vh-6rem)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="shrink-0 bg-white rounded-t-xl border-b px-6 py-4 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-gray-900">
                                    {editingItem?.id ? 'Edit' : 'Create'} {tabLabels[activeTab]}
                                </h2>
                                <button
                                    onClick={() => { setShowModal(false); setEditingItem(null); }}
                                    className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                                >
                                    &times;
                                </button>
                            </div>
                            
                            {/* Modal Body - scrollable */}
                        <div className="overflow-y-auto flex-1 px-6 py-5">
                            {isStoryTab(activeTab) && renderStoryForm()}
                            {activeTab === 'gallery' && renderGalleryForm()}
                            {activeTab === 'recipes' && renderRecipeForm()}
                        </div>
                        
                        {/* Modal Footer */}
                        <div className="shrink-0 bg-white rounded-b-xl border-t px-6 py-4 flex justify-end gap-3">
                            <button
                                onClick={() => { setShowModal(false); setEditingItem(null); }}
                                className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ImpactContentManagement;
