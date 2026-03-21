import React, { useState, useEffect } from 'react';
import VerificationService, { VERIFICATION_STATUS } from '../../utils/verificationService';
import VerificationStatus, { VerificationProgress, VerificationPhotos } from '../../components/food/VerificationStatus';
import Button from '../../components/common/Button';

/**
 * Admin Verification Management Page
 * Allows admins to review verification photos and manage disputes
 */
function VerificationManagement() {
  const [listings, setListings] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, pending, disputed, completed
  const [selectedListing, setSelectedListing] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load verification statistics
      const statsData = await VerificationService.getVerificationStats();
      setStats(statsData);

      // Load listings with verification data
      // This would be a custom admin query
      // For now, we'll use a placeholder
      setListings([]);
      setDisputes([]);
    } catch (error) {
      console.error('Failed to load verification data:', error);
      setError('Failed to load verification data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredListings = listings.filter(listing => {
    if (filter === 'all') return true;
    if (filter === 'pending') return listing.verification_status === VERIFICATION_STATUS.PENDING;
    if (filter === 'disputed') return listing.verification_status === VERIFICATION_STATUS.DISPUTED;
    if (filter === 'completed') return listing.verification_status === VERIFICATION_STATUS.COMPLETED;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading verification data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">
        <i className="fas fa-check-double text-[#2CABE3] mr-3"></i>
        Verification Management
      </h1>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Listings"
            value={stats.total}
            icon="fas fa-list"
            color="blue"
          />
          <StatCard
            label="Pending Verification"
            value={stats.pending}
            icon="fas fa-clock"
            color="yellow"
          />
          <StatCard
            label="Completed"
            value={stats.completed}
            icon="fas fa-check-circle"
            color="green"
          />
          <StatCard
            label="Disputed"
            value={stats.disputed}
            icon="fas fa-exclamation-triangle"
            color="red"
          />
        </div>
      )}

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow-sm mb-6">
        <div className="flex border-b border-gray-200">
          <FilterTab
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="All"
            count={listings.length}
          />
          <FilterTab
            active={filter === 'pending'}
            onClick={() => setFilter('pending')}
            label="Pending"
            count={stats?.pending || 0}
          />
          <FilterTab
            active={filter === 'disputed'}
            onClick={() => setFilter('disputed')}
            label="Disputed"
            count={stats?.disputed || 0}
          />
          <FilterTab
            active={filter === 'completed'}
            onClick={() => setFilter('completed')}
            label="Completed"
            count={stats?.completed || 0}
          />
        </div>
      </div>

      {/* Listings Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Food Item
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Progress
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredListings.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-12 text-center text-gray-500">
                  <i className="fas fa-inbox text-4xl mb-3 block"></i>
                  No listings found
                </td>
              </tr>
            ) : (
              filteredListings.map(listing => (
                <tr key={listing.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <img
                        src={listing.image_url}
                        alt={listing.title}
                        className="h-10 w-10 rounded object-cover mr-3"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{listing.title}</div>
                        <div className="text-sm text-gray-500">{listing.category}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <VerificationStatus status={listing.verification_status} compact={true} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm">
                      {listing.verified_before_pickup && (
                        <span className="text-[#2CABE3]">
                          <i className="fas fa-check-circle mr-1"></i>
                          Before
                        </span>
                      )}
                      {listing.verified_after_pickup && (
                        <span className="text-[#2CABE3]">
                          <i className="fas fa-check-circle mr-1"></i>
                          After
                        </span>
                      )}
                      {!listing.verified_before_pickup && !listing.verified_after_pickup && (
                        <span className="text-gray-400">No verifications</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedListing(listing)}
                    >
                      View Details
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Listing Details Modal */}
      {selectedListing && (
        <ListingDetailsModal
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
        />
      )}
    </div>
  );
}

// Helper Components
function StatCard({ label, value, icon, color }) {
  const colorClasses = {
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
    green: 'bg-[#2CABE3]',
    red: 'bg-red-500'
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-full ${colorClasses[color]} flex items-center justify-center text-white`}>
          <i className={icon}></i>
        </div>
      </div>
    </div>
  );
}

function FilterTab({ active, onClick, label, count }) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
        active
          ? 'border-[#2CABE3] text-[#2CABE3]'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label} {count !== undefined && `(${count})`}
    </button>
  );
}

function ListingDetailsModal({ listing, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="bg-[#2CABE3] text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
          <h2 className="text-2xl font-bold">Verification Details</h2>
          <button onClick={onClose} className="text-white hover:opacity-90">
            <i className="fas fa-times text-2xl"></i>
          </button>
        </div>

        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">{listing.title}</h3>

          <VerificationProgress
            verifiedBefore={listing.verified_before_pickup}
            verifiedAfter={listing.verified_after_pickup}
            verificationRequired={listing.verification_required}
          />

          {listing.verification_before_photos && listing.verification_before_photos.length > 0 && (
            <VerificationPhotos
              photos={listing.verification_before_photos}
              title="Before Pickup Photos"
            />
          )}

          {listing.verification_after_photos && listing.verification_after_photos.length > 0 && (
            <VerificationPhotos
              photos={listing.verification_after_photos}
              title="After Pickup Photos"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default VerificationManagement;
