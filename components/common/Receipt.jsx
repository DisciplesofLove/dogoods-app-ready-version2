import { useState } from 'react';
import PropTypes from 'prop-types';
import supabase, { SUPABASE_AUTH_KEY } from '../../utils/supabaseClient';
import { formatDate } from '../../utils/helpers';

// REST helper for food_listings updates (avoids RLS issues for non-owner updates)
async function patchFoodListings(ids, status) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    let accessToken = supabaseKey;
    try {
        const session = JSON.parse(localStorage.getItem(SUPABASE_AUTH_KEY) || '{}');
        if (session?.access_token) accessToken = session.access_token;
    } catch (_) { /* use anon key */ }

    for (const id of ids) {
        try {
            await fetch(`${supabaseUrl}/rest/v1/food_listings?id=eq.${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: supabaseKey,
                    Authorization: `Bearer ${accessToken}`,
                    Prefer: 'return=minimal',
                },
                body: JSON.stringify({ status }),
            });
        } catch (err) {
            console.warn('Failed to update listing status:', id, err);
        }
    }
}

/**
 * Receipt Component - Displays aggregated food claims
 * Three states: pending (green "Pick Up"), completed (grey), expired (orange "Reclaim")
 */
export default function Receipt({ receipt, items, onUpdate }) {
    const [loading, setLoading] = useState(false);

    // Determine receipt state and styling
    const getReceiptState = () => {
        if (receipt.status === 'completed') {
            return {
                headerClass: 'bg-gray-400',
                headerText: 'DATE COMPLETE',
                buttonText: 'Complete',
                buttonClass: 'bg-gray-400 cursor-not-allowed',
                buttonDisabled: true
            };
        } else if (receipt.status === 'expired') {
            return {
                headerClass: 'bg-orange-500',
                headerText: 'ORDER NOT PICKED UP',
                buttonText: 'Reclaim',
                buttonClass: 'bg-primary-600 hover:bg-primary-700 shadow-lg',
                buttonDisabled: false
            };
        } else {
            return {
                headerClass: 'bg-primary-600',
                headerText: 'DATE CLAIMED',
                buttonText: 'Pick Up',
                buttonClass: 'bg-primary-600 hover:bg-primary-700 shadow-lg',
                buttonDisabled: false
            };
        }
    };

    const state = getReceiptState();

    // Handle pickup button click
    const handlePickup = async () => {
        if (loading) return;

        setLoading(true);
        try {
            // Update receipt status to completed
            const { error: receiptError } = await supabase
                .from('receipts')
                .update({
                    status: 'completed',
                    picked_up_at: new Date().toISOString()
                })
                .eq('id', receipt.id);

            if (receiptError) throw receiptError;

            // Update all associated food_claims
            const { error: claimsError } = await supabase
                .from('food_claims')
                .update({ status: 'completed' })
                .eq('receipt_id', receipt.id);

            if (claimsError) throw claimsError;

            // Permanently remove items from inventory (they've been picked up)
            const foodIds = items.map(item => item.food_id).filter(Boolean);
            if (foodIds.length > 0) {
                await patchFoodListings(foodIds, 'completed');
            }

            // Notify parent component of update
            if (onUpdate) onUpdate();

        } catch (error) {
            console.error('Error completing pickup:', error);
            alert('Failed to complete pickup. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Handle reclaim button click (for expired receipts)
    const handleReclaim = async () => {
        if (loading) return;

        setLoading(true);
        try {
            // Create a new receipt for reclaiming
            const pickupBy = new Date();
            pickupBy.setDate(pickupBy.getDate() + (5 - pickupBy.getDay() + 7) % 7 || 7);
            pickupBy.setHours(23, 59, 59, 0);

            const { data: newReceipt, error: receiptError } = await supabase
                .from('receipts')
                .insert({
                    user_id: receipt.user_id,
                    status: 'pending',
                    pickup_location: receipt.pickup_location,
                    pickup_address: receipt.pickup_address,
                    pickup_window: receipt.pickup_window,
                    pickup_by: pickupBy.toISOString()
                })
                .select()
                .single();

            if (receiptError) throw receiptError;

            // Update food listings back to claimed status
            const foodIds = items.map(item => item.food_id).filter(Boolean);
            if (foodIds.length > 0) {
                await patchFoodListings(foodIds, 'claimed');
            }

            // Update claims to point to new receipt
            const { error: claimsError } = await supabase
                .from('food_claims')
                .update({
                    receipt_id: newReceipt.id,
                    status: 'approved'
                })
                .in('food_id', foodIds)
                .eq('claimer_id', receipt.user_id);

            if (claimsError) throw claimsError;

            // Notify parent component
            if (onUpdate) onUpdate();

        } catch (error) {
            console.error('Error reclaiming items:', error);
            alert('Failed to reclaim items. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleButtonClick = () => {
        if (receipt.status === 'expired') {
            handleReclaim();
        } else if (receipt.status === 'pending') {
            handlePickup();
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden border-2 border-gray-200 max-w-sm">
            {/* Header */}
            <div className={`${state.headerClass} text-white px-6 py-4`}>
                <h3 className="text-xl font-bold">Receipt</h3>
                <p className="text-sm font-medium mt-1">{state.headerText}</p>
            </div>

            {/* Expired Notice (if applicable) */}
            {receipt.status === 'expired' && (
                <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mx-4 mt-4">
                    <p className="text-sm text-orange-800">
                        <strong>Note:</strong> This order was not picked up in the end of the week, and has been 
                        automatically canceled. Please click Reclaim if you would like to order it again. 
                        Please note that some items may no longer be available.
                    </p>
                </div>
            )}

            {/* Items List */}
            <div className="px-6 py-6">
                <div className="space-y-2 mb-6">
                    {items.map((item, index) => (
                        <div key={index} className="flex justify-between text-gray-800">
                            <span className="font-medium">{item.food_name || item.name}</span>
                            <span className="ml-4">{item.quantity || item.amount}</span>
                        </div>
                    ))}
                </div>

                {/* Pickup Location */}
                <div className="border-t pt-4 mt-4 text-sm text-gray-700 space-y-1">
                    <p className="font-semibold">Pick-up location: {receipt.pickup_location}</p>
                    <p><strong>Address:</strong> {receipt.pickup_address}</p>
                    <p><strong>Pick-up window:</strong> {receipt.pickup_window}</p>
                </div>

                {/* Dates */}
                <div className="mt-4 text-xs text-gray-500">
                    <p>Claimed: {formatDate(receipt.claimed_at)}</p>
                    <p>Pickup by: {formatDate(receipt.pickup_by)}</p>
                    {receipt.picked_up_at && (
                        <p>Picked up: {formatDate(receipt.picked_up_at)}</p>
                    )}
                </div>
            </div>

            {/* Action Button */}
            <div className="px-6 pb-6">
                <button
                    onClick={handleButtonClick}
                    disabled={state.buttonDisabled || loading}
                    className={`w-full py-3 rounded-full text-white font-bold text-lg transition-all duration-200 ${state.buttonClass}`}
                >
                    {loading ? 'Processing...' : state.buttonText}
                </button>
            </div>
        </div>
    );
}

Receipt.propTypes = {
    receipt: PropTypes.shape({
        id: PropTypes.string.isRequired,
        user_id: PropTypes.string.isRequired,
        status: PropTypes.oneOf(['pending', 'completed', 'expired']).isRequired,
        pickup_location: PropTypes.string,
        pickup_address: PropTypes.string,
        pickup_window: PropTypes.string,
        claimed_at: PropTypes.string.isRequired,
        pickup_by: PropTypes.string.isRequired,
        picked_up_at: PropTypes.string,
        expired_at: PropTypes.string
    }).isRequired,
    items: PropTypes.arrayOf(PropTypes.shape({
        food_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        food_name: PropTypes.string,
        name: PropTypes.string,
        quantity: PropTypes.string,
        amount: PropTypes.string
    })).isRequired,
    onUpdate: PropTypes.func
};
