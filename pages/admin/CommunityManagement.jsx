import React from 'react';
import AdminLayout from './AdminLayout';
import supabase from '../../utils/supabaseClient';
import Button from '../../components/common/Button';
import { toast } from 'react-toastify';

// Direct REST helper to bypass RLS issues (same pattern as ImpactContentManagement)
const supabaseRest = async (table, method = 'GET', body = null, filters = '') => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || localStorage.getItem('supabase_access_token');
  const supabaseUrl = supabase.supabaseUrl || 'https://ifzbpqyuhnxbhdcnmvfs.supabase.co';
  const supabaseKey = supabase.supabaseKey || supabase._supabaseKey || localStorage.getItem('supabase_anon_key');

  const headers = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${token}`,
    'Prefer': method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : undefined
  };
  // Remove undefined headers
  Object.keys(headers).forEach(k => headers[k] === undefined && delete headers[k]);

  const url = `${supabaseUrl}/rest/v1/${table}${filters}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`REST ${method} ${table} failed (${res.status}): ${errText}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const CommunityManagement = () => {
  const [communities, setCommunities] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showModal, setShowModal] = React.useState(false);
  const [editingCommunity, setEditingCommunity] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: '',
    location: '',
    contact: '',
    phone: '',
    image: '',
    hours: '',
    latitude: '',
    longitude: '',
    is_active: true
  });

  React.useEffect(() => {
    fetchCommunities();

    const subscription = supabase
      .channel('community-management')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'communities'
        },
        () => {
          console.log('Community data changed, refreshing...');
          fetchCommunities();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const fetchCommunities = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('communities')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setCommunities(data || []);
    } catch (error) {
      console.error('Error fetching communities:', error);
      setCommunities([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (submitting) return;
    setSubmitting(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be logged in. Please log in to the admin panel.');

      // Build payload, converting lat/lng to numbers if provided
      const payload = {
        name: formData.name,
        location: formData.location,
        contact: formData.contact,
        phone: formData.phone,
        image: formData.image || null,
        hours: formData.hours || null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        is_active: formData.is_active,
        updated_at: new Date().toISOString()
      };
      
      if (editingCommunity) {
        await supabaseRest('communities', 'PATCH', payload, `?id=eq.${editingCommunity.id}`);
        toast.success('Community updated successfully!');
      } else {
        payload.created_at = new Date().toISOString();
        await supabaseRest('communities', 'POST', payload);
        toast.success('Community added successfully!');
      }

      setShowModal(false);
      setEditingCommunity(null);
      setFormData({
        name: '',
        location: '',
        contact: '',
        phone: '',
        image: '',
        hours: '',
        latitude: '',
        longitude: '',
        is_active: true
      });
      fetchCommunities();
    } catch (error) {
      console.error('Error saving community:', error);
      toast.error('Failed to save community: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (community) => {
    setEditingCommunity(community);
    setFormData({
      name: community.name || '',
      location: community.location || '',
      contact: community.contact || '',
      phone: community.phone || '',
      image: community.image || '',
      hours: community.hours || '',
      latitude: community.latitude != null ? String(community.latitude) : '',
      longitude: community.longitude != null ? String(community.longitude) : '',
      is_active: community.is_active !== false
    });
    setShowModal(true);
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await supabaseRest('communities', 'DELETE', null, `?id=eq.${id}`);
      toast.success('Community deleted successfully!');
      fetchCommunities();
    } catch (error) {
      console.error('Error deleting community:', error);
      toast.error('Failed to delete community: ' + error.message);
    }
  };

  const handleToggleActive = async (id, currentStatus) => {
    try {
      await supabaseRest('communities', 'PATCH', { is_active: !currentStatus, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
      toast.success(`Community ${currentStatus ? 'deactivated' : 'activated'}`);
      fetchCommunities();
    } catch (error) {
      console.error('Error toggling active status:', error);
      toast.error('Failed to update active status');
    }
  };

  const handleAddNew = () => {
    setEditingCommunity(null);
    setFormData({
      name: '',
      location: '',
      contact: '',
      phone: '',
      image: '',
      hours: '',
      latitude: '',
      longitude: '',
      is_active: true
    });
    setShowModal(true);
  };

  return (
    <AdminLayout active="communities">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              <i className="fas fa-city text-[#2CABE3] mr-3"></i>
              Community Management
            </h1>
            <p className="text-gray-500 mt-1">{communities.length} communit{communities.length === 1 ? 'y' : 'ies'} total</p>
          </div>
          <Button onClick={handleAddNew}>
            <i className="fas fa-plus mr-2"></i>
            Add Community
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading communities...</p>
          </div>
        ) : communities.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <i className="fas fa-city text-5xl text-gray-300 mb-4"></i>
            <h3 className="text-xl font-semibold text-gray-600 mb-2">No Communities Yet</h3>
            <p className="text-gray-500 mb-6">Get started by adding your first community.</p>
            <Button onClick={handleAddNew}>
              <i className="fas fa-plus mr-2"></i>
              Add First Community
            </Button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Community
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {communities.map((community) => (
                  <tr key={community.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {community.image && (
                          <img
                            src={community.image}
                            alt={community.name}
                            className="h-10 w-10 rounded-full object-cover mr-3"
                          />
                        )}
                        <div className="text-sm font-medium text-gray-900">
                          {community.name}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{community.location}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{community.contact}</div>
                      <div className="text-sm text-gray-500">{community.phone}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        community.is_active ? 'bg-[#2CABE3]/20 text-[#2CABE3]' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {community.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleEdit(community)}
                      >
                        <i className="fas fa-edit"></i>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleToggleActive(community.id, community.is_active)}
                      >
                        <i className={`fas fa-${community.is_active ? 'eye-slash' : 'eye'}`}></i>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDelete(community.id, community.name)}
                      >
                        <i className="fas fa-trash text-red-600"></i>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-[#2CABE3] text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
                <h2 className="text-2xl font-bold">
                  {editingCommunity ? 'Edit Community' : 'Add New Community'}
                </h2>
                <button onClick={() => setShowModal(false)} className="text-white hover:opacity-90">
                  <i className="fas fa-times text-2xl"></i>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Community Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location *
                  </label>
                  <input
                    type="text"
                    name="location"
                    value={formData.location}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                    placeholder="e.g., 123 Main Street, Oakland, CA 94601"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Contact Person *
                  </label>
                  <input
                    type="text"
                    name="contact"
                    value={formData.contact}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                    placeholder="(510) 123-4567"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Image URL
                  </label>
                  <input
                    type="url"
                    name="image"
                    value={formData.image}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                    placeholder="https://example.com/image.png"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter a URL to a community logo or image
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Operating Hours
                  </label>
                  <input
                    type="text"
                    name="hours"
                    value={formData.hours}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                    placeholder="e.g., Mon-Fri 9am-5pm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      name="latitude"
                      value={formData.latitude}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                      placeholder="e.g., 37.8044"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      name="longitude"
                      value={formData.longitude}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2CABE3] focus:border-[#2CABE3]"
                      placeholder="e.g., -122.2712"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-gray-500 -mt-2">
                    Coordinates for map display. Use Google Maps to find lat/lng.
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="is_active"
                    checked={formData.is_active}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-[#2CABE3] focus:ring-[#2CABE3] border-gray-300 rounded"
                  />
                  <label className="ml-2 block text-sm text-gray-700">
                    Active (visible to users)
                  </label>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <i className="fas fa-spinner fa-spin mr-2"></i>
                        Saving...
                      </>
                    ) : (
                      editingCommunity ? 'Update Community' : 'Add Community'
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default CommunityManagement;
