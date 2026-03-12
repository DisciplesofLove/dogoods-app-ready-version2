import React from 'react';
import AdminLayout from './AdminLayout';
import Button from '../../components/common/Button';
import supabase from '../../utils/supabaseClient';
import { useAuthContext } from '../../utils/AuthContext';

const CATEGORIES = [
    { value: '', label: 'Select Category' },
    { value: 'produce', label: 'Fresh Produce' },
    { value: 'dairy', label: 'Dairy' },
    { value: 'bakery', label: 'Bakery' },
    { value: 'pantry', label: 'Pantry Items' },
    { value: 'meat', label: 'Meat & Poultry' },
    { value: 'seafood', label: 'Seafood' },
    { value: 'frozen', label: 'Frozen' },
    { value: 'snacks', label: 'Snacks' },
    { value: 'beverages', label: 'Beverages' },
    { value: 'prepared', label: 'Prepared Foods' }
];

const STATUSES = [
    { value: 'active', label: 'Active' },
    { value: 'pending', label: 'Pending' },
    { value: 'claimed', label: 'Claimed' },
    { value: 'expired', label: 'Expired' }
];

// REST helper: bypasses Supabase JS client auth to avoid hanging
async function supabaseRest(path, method, body = null, extraHeaders = {}) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    let accessToken = supabaseKey;
    try {
        const sessionData = JSON.parse(localStorage.getItem('sb-ifzbpqyuhnxbhdcnmvfs-auth-token') || '{}');
        if (sessionData?.access_token) accessToken = sessionData.access_token;
    } catch (e) { /* use anon key */ }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${accessToken}`,
        ...extraHeaders,
    };

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    opts.signal = controller.signal;

    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, opts);
    clearTimeout(timeout);

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${method} ${path} failed: ${response.status} - ${errText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }
    return null;
}

// Uncontrolled input to avoid re-renders (same pattern as ImpactDataEntry)
const UncontrolledCell = ({ defaultValue, onBlur, type = 'text', inputRef, className, placeholder }) => (
    <input
        ref={inputRef}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onBlur={(e) => {
            const value = type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value;
            onBlur(value);
        }}
        className={className || "w-full min-w-[150px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"}
    />
);

function AdminShareFood() {
    const { user } = useAuthContext();
    const [data, setData] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [communities, setCommunities] = React.useState([]);
    const [filterCommunity, setFilterCommunity] = React.useState('');
    const [filterStatus, setFilterStatus] = React.useState('all');
    const [dateFilter, setDateFilter] = React.useState('all');

    // Refs for new row inputs (uncontrolled)
    const newRowRefs = React.useRef({
        title: null,
        community_id: null,
        category: null,
        quantity: null,
        unit: null,
        description: null,
        expiry_date: null,
        donor_name: null,
    });

    React.useEffect(() => {
        fetchCommunities();
        fetchData();
    }, []);

    const fetchCommunities = async () => {
        try {
            const { data, error } = await supabase
                .from('communities')
                .select('id, name')
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            setCommunities(data || []);
        } catch (err) {
            console.error('Error fetching communities:', err);
            setCommunities([]);
        }
    };

    const fetchData = async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const { data: listings, error } = await supabase
                .from('food_listings')
                .select('*, users:user_id(id, name)')
                .order('created_at', { ascending: false })
                .abortSignal(controller.signal);

            clearTimeout(timeoutId);

            if (error) throw error;
            setData(listings || []);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Fetch timed out after 15 seconds');
            } else {
                console.error('Error fetching food listings:', error);
            }
            if (!isRefresh) setData([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    // Filter data
    const filteredData = React.useMemo(() => {
        let filtered = data;

        if (filterCommunity) {
            filtered = filtered.filter(row => String(row.community_id) === String(filterCommunity));
        }
        if (filterStatus !== 'all') {
            filtered = filtered.filter(row => row.status === filterStatus);
        }
        if (dateFilter !== 'all') {
            const now = new Date();
            filtered = filtered.filter(row => {
                const rowDate = new Date(row.created_at);
                switch (dateFilter) {
                    case 'current-week': {
                        const startOfWeek = new Date(now);
                        startOfWeek.setDate(now.getDate() - now.getDay());
                        startOfWeek.setHours(0, 0, 0, 0);
                        return rowDate >= startOfWeek;
                    }
                    case 'current-month':
                        return rowDate.getFullYear() === now.getFullYear() && rowDate.getMonth() === now.getMonth();
                    default:
                        return true;
                }
            });
        }
        return filtered;
    }, [data, filterCommunity, filterStatus, dateFilter]);

    const communityName = (id) => {
        const c = communities.find(c => String(c.id) === String(id));
        return c?.name || '';
    };

    // Add new row
    const handleAddRow = async () => {
        try {
            const title = newRowRefs.current.title?.value?.trim();
            const communityId = newRowRefs.current.community_id?.value;
            const category = newRowRefs.current.category?.value;
            const quantity = parseFloat(newRowRefs.current.quantity?.value) || 0;
            const unit = newRowRefs.current.unit?.value || 'lb';
            const description = newRowRefs.current.description?.value?.trim() || '';
            const expiryDate = newRowRefs.current.expiry_date?.value || null;
            const donorName = newRowRefs.current.donor_name?.value?.trim() || 'DoGoods Admin';

            if (!title) { alert('⚠️ Title is required.'); return; }
            if (!communityId) { alert('⚠️ Please select a community.'); return; }
            if (!category) { alert('⚠️ Please select a category.'); return; }
            if (!quantity) { alert('⚠️ Quantity is required.'); return; }

            const newListing = {
                title,
                description,
                category,
                quantity,
                unit,
                community_id: communityId,
                expiry_date: expiryDate,
                donor_name: donorName,
                donor_type: 'organization',
                listing_type: 'donation',
                status: 'active',
                user_id: user?.id || null,
            };

            await supabaseRest('food_listings', 'POST', newListing, { 'Prefer': 'return=minimal' });

            // Reset inputs
            if (newRowRefs.current.title) newRowRefs.current.title.value = '';
            if (newRowRefs.current.community_id) newRowRefs.current.community_id.value = '';
            if (newRowRefs.current.category) newRowRefs.current.category.value = '';
            if (newRowRefs.current.quantity) newRowRefs.current.quantity.value = '';
            if (newRowRefs.current.unit) newRowRefs.current.unit.value = 'lb';
            if (newRowRefs.current.description) newRowRefs.current.description.value = '';
            if (newRowRefs.current.expiry_date) newRowRefs.current.expiry_date.value = '';
            if (newRowRefs.current.donor_name) newRowRefs.current.donor_name.value = '';

            await fetchData(true);
            alert('✅ Food listing added!');
        } catch (error) {
            console.error('Error adding food listing:', error);
            const msg = error.message || error.toString();
            if (msg.includes('Failed to fetch')) {
                alert('❌ Network error: Cannot connect to database.');
            } else if (msg.includes('JWT')) {
                alert('❌ Authentication error: Please log out and log back in.');
            } else {
                alert('❌ Failed to add food listing: ' + msg);
            }
        }
    };

    // Update a single field inline
    const handleUpdateRow = async (id, field, value) => {
        try {
            await supabaseRest(
                `food_listings?id=eq.${id}`,
                'PATCH',
                { [field]: value, updated_at: new Date().toISOString() },
                { 'Prefer': 'return=minimal' }
            );
            // Update local
            setData(prev => prev.map(row =>
                row.id === id ? { ...row, [field]: value } : row
            ));
        } catch (error) {
            console.error('Error updating row:', error);
            alert('Failed to update: ' + error.message);
        }
    };

    // Delete row
    const handleDeleteRow = async (id) => {
        if (!confirm('Are you sure you want to delete this food listing?')) return;
        try {
            await supabaseRest(`food_listings?id=eq.${id}`, 'DELETE', null, { 'Prefer': 'return=minimal' });
            await fetchData(true);
            alert('Food listing deleted!');
        } catch (error) {
            console.error('Error deleting row:', error);
            alert('Failed to delete: ' + error.message);
        }
    };

    // Export CSV
    const exportToCSV = () => {
        const headers = ['Created', 'Title', 'Community', 'Category', 'Quantity', 'Unit', 'Status', 'Expiry Date', 'Donor', 'Description'];
        const rows = filteredData.map(row => [
            row.created_at ? new Date(row.created_at).toLocaleDateString() : '',
            row.title || '',
            communityName(row.community_id),
            row.category || '',
            row.quantity || 0,
            row.unit || '',
            row.status || '',
            row.expiry_date || '',
            row.donor_name || '',
            (row.description || '').replace(/"/g, '""')
        ]);

        const csvContent = [headers, ...rows]
            .map(r => r.map(cell => `"${cell}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `food_listings_${new Date().toISOString().split('T')[0]}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <AdminLayout active="share-food">
            <div className="p-6">
                {/* Header */}
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Share Food to Communities</h1>
                        <p className="mt-2 text-gray-600">Add and manage food listings for any community — spreadsheet style</p>
                    </div>
                    <div className="flex space-x-3">
                        <Button
                            variant="secondary"
                            onClick={() => fetchData(true)}
                            disabled={refreshing}
                        >
                            <i className={`fas fa-sync-alt mr-2 ${refreshing ? 'animate-spin' : ''}`}></i>
                            {refreshing ? 'Refreshing...' : 'Refresh'}
                        </Button>
                        <Button
                            variant="primary"
                            onClick={exportToCSV}
                        >
                            <i className="fas fa-download mr-2"></i>
                            Export CSV
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-2">
                            <i className="fas fa-filter text-blue-600"></i>
                            <span className="font-medium text-gray-700">Filters:</span>
                        </div>
                        <div className="flex gap-3 flex-wrap items-center">
                            <select
                                value={filterCommunity}
                                onChange={(e) => setFilterCommunity(e.target.value)}
                                className="px-3 py-2 rounded-md text-sm border border-gray-300 focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                            >
                                <option value="">All Communities</option>
                                {communities.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="px-3 py-2 rounded-md text-sm border border-gray-300 focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                            >
                                <option value="all">All Statuses</option>
                                {STATUSES.map(s => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                            <div className="flex gap-1">
                                {[
                                    { value: 'current-week', label: 'This Week' },
                                    { value: 'current-month', label: 'This Month' },
                                    { value: 'all', label: 'All' }
                                ].map(df => (
                                    <button
                                        key={df.value}
                                        onClick={() => setDateFilter(df.value)}
                                        className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                                            dateFilter === df.value
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-white text-gray-700 hover:bg-blue-100'
                                        }`}
                                    >
                                        {df.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="text-sm text-gray-600">
                            Showing <span className="font-semibold text-blue-700">{filteredData.length}</span> of <span className="font-semibold">{data.length}</span> total listings
                        </div>
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto"></div>
                        <p className="mt-4 text-gray-600">Loading food listings...</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                                        Title
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                                        Community
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-[#2CABE3] uppercase tracking-wider min-w-[140px]">
                                        Category
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-[#2CABE3] uppercase tracking-wider min-w-[80px]">
                                        Qty
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-[#2CABE3] uppercase tracking-wider min-w-[80px]">
                                        Unit
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[250px]">
                                        Description
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[140px]">
                                        Expiry Date
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[150px]">
                                        Donor
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                                        Status
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {/* New row (highlighted) */}
                                <tr className="bg-[#2CABE3]/10">
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.title = el}
                                            onBlur={() => {}}
                                            placeholder="Food title"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <select
                                            ref={el => newRowRefs.current.community_id = el}
                                            className="w-full min-w-[150px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                        >
                                            <option value="">Select Community</option>
                                            {communities.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <select
                                            ref={el => newRowRefs.current.category = el}
                                            className="w-full min-w-[120px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                        >
                                            {CATEGORIES.map(c => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            type="number"
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.quantity = el}
                                            onBlur={() => {}}
                                            placeholder="0"
                                            className="w-full min-w-[60px] px-2 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <select
                                            ref={el => newRowRefs.current.unit = el}
                                            defaultValue="lb"
                                            className="w-full min-w-[60px] px-2 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                        >
                                            <option value="lb">lb</option>
                                            <option value="oz">oz</option>
                                            <option value="kg">kg</option>
                                            <option value="g">g</option>
                                            <option value="count">count</option>
                                            <option value="serving">serving</option>
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.description = el}
                                            onBlur={() => {}}
                                            placeholder="Description"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            type="date"
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.expiry_date = el}
                                            onBlur={() => {}}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.donor_name = el}
                                            onBlur={() => {}}
                                            placeholder="DoGoods Admin"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className="text-sm text-emerald-700 font-medium">Active</span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={handleAddRow}
                                        >
                                            <i className="fas fa-plus"></i>
                                        </Button>
                                    </td>
                                </tr>

                                {/* Existing rows */}
                                {filteredData.map((row) => (
                                    <tr key={row.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                defaultValue={row.title || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'title', val)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={row.community_id || ''}
                                                onChange={(e) => handleUpdateRow(row.id, 'community_id', e.target.value)}
                                                className="w-full min-w-[150px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                            >
                                                <option value="">No Community</option>
                                                {communities.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={row.category || ''}
                                                onChange={(e) => handleUpdateRow(row.id, 'category', e.target.value)}
                                                className="w-full min-w-[120px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                            >
                                                {CATEGORIES.map(c => (
                                                    <option key={c.value} value={c.value}>{c.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                type="number"
                                                defaultValue={row.quantity || 0}
                                                onBlur={(val) => handleUpdateRow(row.id, 'quantity', val)}
                                                className="w-full min-w-[60px] px-2 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={row.unit || 'lb'}
                                                onChange={(e) => handleUpdateRow(row.id, 'unit', e.target.value)}
                                                className="w-full min-w-[60px] px-2 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                            >
                                                <option value="lb">lb</option>
                                                <option value="oz">oz</option>
                                                <option value="kg">kg</option>
                                                <option value="g">g</option>
                                                <option value="count">count</option>
                                                <option value="serving">serving</option>
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                defaultValue={row.description || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'description', val)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                type="date"
                                                defaultValue={row.expiry_date || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'expiry_date', val || null)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                defaultValue={row.donor_name || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'donor_name', val)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={row.status || 'active'}
                                                onChange={(e) => handleUpdateRow(row.id, 'status', e.target.value)}
                                                className={`w-full min-w-[80px] px-2 py-3 text-sm font-medium border rounded focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent ${
                                                    row.status === 'active' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                                                    row.status === 'pending' ? 'border-yellow-300 text-yellow-700 bg-yellow-50' :
                                                    row.status === 'claimed' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                                                    'border-gray-300 text-gray-700 bg-gray-50'
                                                }`}
                                            >
                                                {STATUSES.map(s => (
                                                    <option key={s.value} value={s.value}>{s.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => handleDeleteRow(row.id)}
                                            >
                                                <i className="fas fa-trash"></i>
                                            </Button>
                                        </td>
                                    </tr>
                                ))}

                                {filteredData.length === 0 && (
                                    <tr>
                                        <td colSpan="10" className="px-6 py-8 text-center text-gray-500">
                                            No food listings yet. Add your first listing using the row above.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Help section */}
                <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-blue-900 mb-2">
                        <i className="fas fa-info-circle mr-2"></i>
                        How to use this system
                    </h3>
                    <ul className="text-sm text-blue-800 space-y-1">
                        <li>• Fill in the highlighted row at the top to add a new food listing, then click the <strong>+</strong> button</li>
                        <li>• New listings are created as <strong>Active</strong> and immediately visible to community members</li>
                        <li>• Click on any cell to edit existing data — changes save automatically on blur</li>
                        <li>• Use the <strong>Community</strong> dropdown to assign food to a specific community</li>
                        <li>• Change the <strong>Status</strong> dropdown to activate, deactivate, or mark as claimed</li>
                        <li>• Use the trash icon to permanently delete a listing</li>
                        <li>• Use <strong>Filters</strong> to narrow by community, status, or date range</li>
                        <li>• Export to CSV for backup or reporting</li>
                    </ul>
                </div>
            </div>
        </AdminLayout>
    );
}

export default AdminShareFood;
