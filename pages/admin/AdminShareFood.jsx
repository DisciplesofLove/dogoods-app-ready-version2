import React from 'react';
import AdminLayout from './AdminLayout';
import Button from '../../components/common/Button';
import supabase from '../../utils/supabaseClient';
import { useAuthContext } from '../../utils/AuthContext';
import { API_CONFIG } from '../../utils/config';

// Generic food image used for all bulk food listings
const GENERIC_FOOD_IMAGE = 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80';

// Geocode an address using Mapbox to get latitude/longitude
async function geocodeAddress(address) {
    if (!address) return { latitude: null, longitude: null, location: null, donor_city: null, donor_state: null };
    const token = API_CONFIG.MAPBOX?.ACCESS_TOKEN;
    if (!token) {
        console.warn('No Mapbox token — skipping geocoding');
        return { latitude: null, longitude: null, location: null, donor_city: null, donor_state: null };
    }
    try {
        const encoded = encodeURIComponent(address);
        const resp = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=us`
        );
        if (!resp.ok) throw new Error('Geocoding request failed');
        const json = await resp.json();
        const feature = json.features?.[0];
        if (!feature) return { latitude: null, longitude: null, location: address, donor_city: null, donor_state: null };
        const [lng, lat] = feature.center;
        // Extract city and state from context
        const cityCtx = feature.context?.find(c => c.id?.startsWith('place'));
        const stateCtx = feature.context?.find(c => c.id?.startsWith('region'));
        const city = cityCtx?.text || feature.text || null;
        const state = stateCtx?.short_code?.replace('US-', '') || stateCtx?.text || null;
        return {
            latitude: lat,
            longitude: lng,
            location: feature.place_name || address,
            donor_city: city,
            donor_state: state,
        };
    } catch (err) {
        console.warn('Geocoding failed, continuing without coordinates:', err.message);
        return { latitude: null, longitude: null, location: address, donor_city: null, donor_state: null };
    }
}

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
const UncontrolledCell = ({ defaultValue, onBlur, type = 'text', inputRef, className }) => (
    <input
        ref={inputRef}
        type={type}
        defaultValue={defaultValue}
        onBlur={(e) => {
            const value = type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value;
            onBlur(value);
        }}
        className={className || "w-full min-w-[200px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"}
    />
);

function AdminShareFood() {
    const { user } = useAuthContext();
    const [data, setData] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [communities, setCommunities] = React.useState([]);
    const [dateFilter, setDateFilter] = React.useState('current-week');

    // Refs for new row inputs (uncontrolled) — same pattern as ImpactDataEntry
    const newRowRefs = React.useRef({
        date: null,
        community_id: null,
        title: null,
        quantity: null,
        pickup_by: null,
        expiry_date: null,
        full_address: null,
        donor_name: null,
        notes: null,
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
                .order('name', { ascending: true });
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

            // Add a timeout to prevent infinite loading
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const { data: listings, error } = await supabase
                .from('food_listings')
                .select('*')
                .eq('donor_type', 'organization')
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

    // Filter data — same pattern as ImpactDataEntry
    const filteredData = React.useMemo(() => {
        let filtered = data;

        if (dateFilter !== 'all') {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();

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
                        return rowDate.getFullYear() === currentYear && rowDate.getMonth() === currentMonth;
                    default:
                        return true;
                }
            });
        }
        return filtered;
    }, [data, dateFilter]);

    const communityName = (id) => {
        const c = communities.find(c => String(c.id) === String(id));
        return c?.name || '';
    };

    // Add new row
    const handleAddRow = async () => {
        try {
            const date = newRowRefs.current.date?.value || new Date().toISOString().split('T')[0];
            const communityId = newRowRefs.current.community_id?.value;
            const title = newRowRefs.current.title?.value?.trim();
            const quantity = parseFloat(newRowRefs.current.quantity?.value) || 0;
            const pickupBy = newRowRefs.current.pickup_by?.value || null;
            const expiryDate = newRowRefs.current.expiry_date?.value || null;
            const fullAddress = newRowRefs.current.full_address?.value?.trim() || '';
            const donorName = newRowRefs.current.donor_name?.value?.trim() || 'DoGoods Admin';
            const notes = newRowRefs.current.notes?.value?.trim() || '';

            if (!title) { alert('⚠️ Food name is required.'); return; }
            if (!communityId) { alert('⚠️ Please select a community.'); return; }
            if (!quantity) { alert('⚠️ Quantity (lb) is required.'); return; }

            // Geocode address to get lat/lng for map display
            const geo = await geocodeAddress(fullAddress);

            const newListing = {
                title,
                description: notes,
                category: 'produce',
                quantity,
                unit: 'lb',
                community_id: parseInt(communityId, 10),
                pickup_by: pickupBy ? new Date(pickupBy + 'T17:00:00').toISOString() : null,
                expiry_date: expiryDate || null,
                full_address: fullAddress || null,
                location: geo.location,
                latitude: geo.latitude,
                longitude: geo.longitude,
                donor_name: donorName,
                donor_city: geo.donor_city,
                donor_state: geo.donor_state,
                donor_type: 'organization',
                listing_type: 'donation',
                status: 'active',
                image_url: GENERIC_FOOD_IMAGE,
                user_id: user?.id || null,
                created_at: new Date(date + 'T12:00:00').toISOString(),
            };

            console.log('Attempting to insert food listing:', newListing);

            await supabaseRest('food_listings', 'POST', newListing, { 'Prefer': 'return=minimal' });

            // Reset inputs
            if (newRowRefs.current.date) newRowRefs.current.date.value = new Date().toISOString().split('T')[0];
            if (newRowRefs.current.community_id) newRowRefs.current.community_id.value = '';
            if (newRowRefs.current.title) newRowRefs.current.title.value = '';
            if (newRowRefs.current.quantity) newRowRefs.current.quantity.value = '';
            if (newRowRefs.current.pickup_by) newRowRefs.current.pickup_by.value = '';
            if (newRowRefs.current.expiry_date) newRowRefs.current.expiry_date.value = '';
            if (newRowRefs.current.full_address) newRowRefs.current.full_address.value = '';
            if (newRowRefs.current.donor_name) newRowRefs.current.donor_name.value = '';
            if (newRowRefs.current.notes) newRowRefs.current.notes.value = '';

            await fetchData(true);
            alert('✅ Bulk food listing added!');
        } catch (error) {
            console.error('Error adding food listing:', error);
            const msg = error.message || error.toString();
            if (msg.includes('Failed to fetch')) {
                alert('❌ Network error: Cannot connect to database. Please check:\n1. Your internet connection\n2. Supabase configuration in .env.local\n3. Browser console for details');
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
            // Update local data after successful save
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
        const headers = ['Date', 'Community', 'Food Name', 'Quantity (lb)', 'Pickup By', 'Expiry Date', 'Pickup Address', 'Donor', 'Notes'];
        const rows = filteredData.map(row => [
            row.created_at ? new Date(row.created_at).toLocaleDateString() : '',
            communityName(row.community_id),
            row.title || '',
            row.quantity || 0,
            row.pickup_by ? new Date(row.pickup_by).toLocaleDateString() : '',
            row.expiry_date || '',
            row.full_address || '',
            row.donor_name || '',
            (row.description || '').replace(/"/g, '""')
        ]);

        const csvContent = [headers, ...rows]
            .map(r => r.map(cell => `"${cell}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `bulk_food_listings_${new Date().toISOString().split('T')[0]}.csv`;
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
                        <h1 className="text-2xl font-bold text-gray-900">Bulk Food Entry</h1>
                        <p className="mt-2 text-gray-600">Add bulk food listings for communities — data entry style</p>
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

                {/* Date Filter Controls — exact same as ImpactDataEntry */}
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-2">
                            <i className="fas fa-filter text-blue-600"></i>
                            <span className="font-medium text-gray-700">Show entries from:</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => setDateFilter('current-week')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                    dateFilter === 'current-week'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-700 hover:bg-blue-100'
                                }`}
                            >
                                Current Week
                            </button>
                            <button
                                onClick={() => setDateFilter('current-month')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                    dateFilter === 'current-month'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-700 hover:bg-blue-100'
                                }`}
                            >
                                Current Month
                            </button>
                            <button
                                onClick={() => setDateFilter('all')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                    dateFilter === 'all'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-700 hover:bg-blue-100'
                                }`}
                            >
                                <i className="fas fa-archive mr-1"></i>
                                All (Archived)
                            </button>
                        </div>
                        <div className="text-sm text-gray-600">
                            Showing <span className="font-semibold text-blue-700">{filteredData.length}</span> of <span className="font-semibold">{data.length}</span> total entries
                        </div>
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto"></div>
                        <p className="mt-4 text-gray-600">Loading data...</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[220px]">
                                        Date
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[280px]">
                                        Community
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-[#2CABE3] uppercase tracking-wider min-w-[280px]">
                                        Food Name
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-[#2CABE3] uppercase tracking-wider min-w-[110px]">
                                        Quantity (lb)
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-orange-600 uppercase tracking-wider min-w-[160px]">
                                        Pickup By
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-orange-600 uppercase tracking-wider min-w-[160px]">
                                        Expiry Date
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[250px]">
                                        Pickup Address
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">
                                        Donor
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[300px]">
                                        Notes
                                    </th>
                                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px]">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {/* New row (highlighted) — same as ImpactDataEntry */}
                                <tr className="bg-[#2CABE3]/10">
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            type="date"
                                            defaultValue={new Date().toISOString().split('T')[0]}
                                            inputRef={el => newRowRefs.current.date = el}
                                            onBlur={() => {}}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <select
                                            ref={el => newRowRefs.current.community_id = el}
                                            className="w-full min-w-[200px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                        >
                                            <option value="">Select Community</option>
                                            {communities.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.title = el}
                                            onBlur={() => {}}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            type="number"
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.quantity = el}
                                            onBlur={() => {}}
                                            className="w-full min-w-[80px] px-2 py-2 text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            type="date"
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.pickup_by = el}
                                            onBlur={() => {}}
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
                                            inputRef={el => newRowRefs.current.full_address = el}
                                            onBlur={() => {}}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.donor_name = el}
                                            onBlur={() => {}}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <UncontrolledCell
                                            defaultValue=""
                                            inputRef={el => newRowRefs.current.notes = el}
                                            onBlur={() => {}}
                                        />
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
                                                type="date"
                                                defaultValue={row.created_at ? row.created_at.split('T')[0] : ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'created_at', new Date(val + 'T12:00:00').toISOString())}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={row.community_id || ''}
                                                onChange={(e) => handleUpdateRow(row.id, 'community_id', parseInt(e.target.value, 10) || null)}
                                                className="w-full min-w-[200px] px-3 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                            >
                                                <option value="">Select Community</option>
                                                {communities.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                defaultValue={row.title || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'title', val)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                type="number"
                                                defaultValue={row.quantity || 0}
                                                onBlur={(val) => handleUpdateRow(row.id, 'quantity', val)}
                                                className="w-full min-w-[80px] px-2 py-2 text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#2CABE3] focus:border-transparent"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                type="date"
                                                defaultValue={row.pickup_by ? row.pickup_by.split('T')[0] : ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'pickup_by', val ? new Date(val + 'T17:00:00').toISOString() : null)}
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
                                                defaultValue={row.full_address || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'full_address', val)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                defaultValue={row.donor_name || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'donor_name', val)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <UncontrolledCell
                                                defaultValue={row.description || ''}
                                                onBlur={(val) => handleUpdateRow(row.id, 'description', val)}
                                            />
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
                                            No food listings yet. Add your first entry using the row above.
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
                        <li>• <strong>Bulk Food Entry:</strong> Quickly add food donations to any community</li>
                        <li>• Fill in the colored row at the top to add a new entry, then click the + button</li>
                        <li>• All entries use a generic food image and are set to Active status automatically</li>
                        <li>• <strong>Pickup By:</strong> Set the deadline for when food must be picked up</li>
                        <li>• <strong>Expiry Date:</strong> Set when the food expires</li>
                        <li>• <strong>Pickup Address:</strong> Where the food can be collected from</li>
                        <li>• <strong>Donor:</strong> Name of the person or organization donating (defaults to DoGoods Admin)</li>
                        <li>• Click on any cell to edit existing data — changes save automatically</li>
                        <li>• Use the trash icon to delete entries</li>
                        <li>• Export to CSV for backup or analysis</li>
                    </ul>
                </div>
            </div>
        </AdminLayout>
    );
}

export default AdminShareFood;
