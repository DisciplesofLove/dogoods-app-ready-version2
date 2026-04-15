import React from 'react';
import PropTypes from 'prop-types';
import { formatDate, getExpirationStatus, reportError } from "../../utils/helpers";
import Card from "../common/Card";
import Avatar from "../common/Avatar";
import Button from "../common/Button";
import { useAI } from "../../utils/hooks/useSupabase";
import { UrgencyIndicator } from "./UrgencyBadge";
import VerificationStatus from "./VerificationStatus";
import FoodDietaryTags from "./FoodDietaryTags";

const formatDistance = (dist) => {
    if (!dist) return '';
    if (dist < 1) return `${Math.round(dist * 1000)}m away`;
    return `${dist.toFixed(1)}km away`;
};

function FoodCard({
    food,
    onClaim,
    onTrade,
    className = '',
    showReturnButton = false,
    distance,
    matchScore
}) {
    const { getRecipeSuggestions, isLoading: aiLoading } = useAI();
    const [showAITips, setShowAITips] = React.useState(false);
    const [aiSuggestions, setAISuggestions] = React.useState(null);

    if (!food) {
        reportError(new Error('Food data is required'));
        return null;
    }

    const {
        title,
        description,
        image_url,
        quantity,
        unit,
        expiry_date,
        location,
        users,
        donor_name,
        donor_city,
        donor_state,
        type = 'donation', // 'donation' or 'trade'
    } = food;

    const donor = {
        name: donor_name || (users?.[0] || users)?.organization || (users?.[0] || users)?.name || 'Anonymous',
        avatar: (users?.[0] || users)?.avatar_url
    };

    // Use expiry_date from DB, fallback to empty string if missing
    const expirationStatus = getExpirationStatus(expiry_date || '');

    const handleClaim = () => {
        if (typeof onClaim === 'function') {
            onClaim(food);
        } else {
            console.warn('onClaim handler is not defined');
        }
    };

    const handleTrade = () => {
        if (typeof onTrade === 'function') {
            onTrade(food);
        } else {
            console.warn('onTrade handler is not defined');
        }
    };

    const handleReturn = () => {
        window.location.href = '/';
    };

    const handleAIRecipes = async () => {
        if (showAITips) {
            setShowAITips(false);
            return;
        }

        try {
            const ingredients = [title];
            const recipes = await getRecipeSuggestions(ingredients);
            setAISuggestions(recipes);
            setShowAITips(true);
        } catch (error) {
            setAISuggestions({ error: error.message || 'Failed to get recipe suggestions.' });
            setShowAITips(true);
        }
    };

    return (
        <Card
            className={`food-card ${className}`}
            image={image_url}
            title={title}
            subtitle={
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <Avatar 
                                src={donor && donor.avatar ? donor.avatar : undefined} 
                                size="sm" 
                                alt={`${donor && donor.name ? donor.name : 'Donor'}'s avatar`}
                            />
                            <span className="text-sm text-gray-600">{donor && donor.name ? donor.name : 'Unknown Donor'}</span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                            <i className="fas fa-map-marker-alt text-gray-400 mr-2" aria-hidden="true"></i>
                            <span>
                                {donor_city && donor_state ? 
                                    `${donor_city}, ${donor_state}` :
                                    (typeof location === 'object' && location?.address ? 
                                        location.address :
                                        (typeof location === 'string' ? 
                                            location : 
                                            'No location available')
                                    )}
                            </span>
                            {distance && <span className="ml-1 text-gray-500">({formatDistance(distance)})</span>}
                        </div>
                    </div>
                    <div className="flex items-center space-x-2 flex-wrap gap-2">
                        {/* AI Match Score Badge */}
                        {matchScore != null && matchScore > 0 && (
                            <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                                    matchScore >= 80 ? 'bg-green-100 text-green-800' :
                                    matchScore >= 50 ? 'bg-blue-100 text-blue-800' :
                                    'bg-gray-100 text-gray-700'
                                }`}
                                title="AI Match Score based on your location, preferences, and urgency"
                            >
                                🎯 {matchScore}% match
                            </span>
                        )}
                        <UrgencyIndicator foodListing={food} />
                        {food.verification_status && (
                            <VerificationStatus status={food.verification_status} compact={true} />
                        )}
                        {food.ai_verified && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700" title="This listing was verified by AI">
                                ✅ AI Verified
                            </span>
                        )}
                        {food.ai_safety_warning && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700" title={food.ai_safety_warning}>
                                ⚠️ Check freshness
                            </span>
                        )}
                        <span
                            className={`badge badge-${expirationStatus.status}`}
                            role="status"
                            aria-label={`Expiration status: ${expirationStatus.label}`}
                        >
                            {expirationStatus.label}
                        </span>
                        <span className="text-gray-500">
                            {expiry_date ? formatDate(expiry_date) : 'No expiry date'}
                        </span>
                    </div>
                    {/* Dietary Tags */}
                    {(food.dietary_tags?.length > 0 || food.allergen_info?.length > 0) && (
                        <div className="mt-2">
                            <FoodDietaryTags food={food} compact={true} />
                        </div>
                    )}
                </div>
            }
            footer={
                <div className="flex items-center justify-end">
                    <div className="flex space-x-2">
                        {type === 'donation' ? (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleClaim}
                                aria-label={`Claim ${title}`}
                                disabled={!onClaim}
                            >
                                Claim
                            </Button>
                        ) : (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleTrade}
                                aria-label={`Trade ${title}`}
                                disabled={!onTrade}
                            >
                                Trade
                            </Button>
                        )}
                        {/* Recipes button removed for shared food */}
                        {showReturnButton && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleReturn}
                                aria-label="Return to main site"
                            >
                                Return to Site
                            </Button>
                        )}
                    </div>
                </div>
            }
        >
            <div className="space-y-2">
                <p className="text-gray-600">{description}</p>
                <div className="flex items-center">
                    <div className="flex items-center">
                        <i className="fas fa-box-open text-gray-400 mr-2" aria-hidden="true"></i>
                        <span>{quantity} {unit}</span>
                    </div>
                </div>
                
                {/* AI Recipe Suggestions */}
                {showAITips && aiSuggestions && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="font-semibold text-blue-800 mb-2 flex items-center">
                            <i className="fas fa-robot mr-2"></i>
                            AI Recipe Suggestions
                        </h4>
                        {aiSuggestions.error ? (
                            <p className="text-sm text-red-600">{aiSuggestions.error}</p>
                        ) : aiSuggestions.recipes && aiSuggestions.recipes.length > 0 ? (
                            <div className="space-y-2">
                                {aiSuggestions.recipes.slice(0, 2).map((recipe, index) => (
                                    <div key={index} className="text-sm">
                                        <p className="font-medium text-blue-700">{recipe.name}</p>
                                        <p className="text-blue-600 text-xs">{recipe.instructions}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-blue-600">
                                {typeof aiSuggestions === 'string' ? aiSuggestions : 'No recipes found.'}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
}

FoodCard.propTypes = {
    food: PropTypes.shape({
        id: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        description: PropTypes.string,
        image_url: PropTypes.string,
        quantity: PropTypes.number,
        unit: PropTypes.string,
        expiry_date: PropTypes.string,
        location: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
        type: PropTypes.oneOf(['donation', 'trade']),
        donor_name: PropTypes.string,
        donor_city: PropTypes.string,
        donor_state: PropTypes.string,
        users: PropTypes.oneOfType([PropTypes.object, PropTypes.array])
    }).isRequired,
    onClaim: PropTypes.func,
    onTrade: PropTypes.func,
    className: PropTypes.string,
    showReturnButton: PropTypes.bool,
    distance: PropTypes.number
};

export default FoodCard;