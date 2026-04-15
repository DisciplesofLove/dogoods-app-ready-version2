import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import ErrorBoundary from "../components/common/ErrorBoundary";
import { reportError, timeAgo } from "../utils/helpers";
import { useAuth, useNotifications } from "../utils/hooks/useSupabase";

const CATEGORIES = {
    all: { label: "All", icon: "fa-bell", color: "gray" },
    food_match: { label: "🍎 Food Match", icon: "fa-utensils", color: "green" },
    expiry_alert: { label: "⏰ Expiry Alert", icon: "fa-clock", color: "orange" },
    nearby_food: { label: "📍 Nearby Food", icon: "fa-map-marker-alt", color: "blue" },
    claim_update: { label: "🎉 Claim Update", icon: "fa-hand-holding-heart", color: "purple" },
    food_claimed: { label: "🎉 Claim Update", icon: "fa-hand-holding-heart", color: "purple" },
    trade_request: { label: "🔄 Trade", icon: "fa-exchange-alt", color: "indigo" },
    system: { label: "🔔 System", icon: "fa-cog", color: "gray" },
};

function getCategoryInfo(type) {
    return CATEGORIES[type] || CATEGORIES.system;
}

const colorMap = {
    green: { bg: "bg-green-100", text: "text-green-600", ring: "ring-green-200", badge: "bg-green-500" },
    orange: { bg: "bg-orange-100", text: "text-orange-600", ring: "ring-orange-200", badge: "bg-orange-500" },
    blue: { bg: "bg-blue-100", text: "text-blue-600", ring: "ring-blue-200", badge: "bg-blue-500" },
    purple: { bg: "bg-purple-100", text: "text-purple-600", ring: "ring-purple-200", badge: "bg-purple-500" },
    indigo: { bg: "bg-indigo-100", text: "text-indigo-600", ring: "ring-indigo-200", badge: "bg-indigo-500" },
    gray: { bg: "bg-gray-100", text: "text-gray-600", ring: "ring-gray-200", badge: "bg-gray-500" },
};

function Notifications() {
    const { user: authUser, isAuthenticated } = useAuth();
    const { notifications, loading, error, markAsRead, unreadCount } = useNotifications(authUser?.id);
    const navigate = useNavigate();
    const [activeFilter, setActiveFilter] = useState("all");

    const filteredNotifications = useMemo(() => {
        if (activeFilter === "all") return notifications;
        // Map claim_update and food_claimed to the same filter
        return notifications.filter(n => {
            if (activeFilter === "claim_update") return n.type === "claim_update" || n.type === "food_claimed";
            return n.type === activeFilter;
        });
    }, [notifications, activeFilter]);

    const categoryCounts = useMemo(() => {
        const counts = {};
        notifications.forEach(n => {
            const key = n.type === "food_claimed" ? "claim_update" : (n.type || "system");
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }, [notifications]);

    const handleMarkAsRead = async (notificationId) => {
        try {
            await markAsRead(notificationId);
        } catch (err) {
            console.error('Error marking notification as read:', err);
            reportError(err);
        }
    };

    const markAllAsRead = async () => {
        try {
            const unread = notifications.filter(n => !n.read);
            await Promise.all(unread.map(n => markAsRead(n.id)));
        } catch (err) {
            console.error('Error marking all as read:', err);
            reportError(err);
        }
    };

    if (!isAuthenticated) return null;

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto py-8 px-4">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading notifications...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="max-w-4xl mx-auto py-8 px-4">
                <div className="text-center text-red-600">Error loading notifications: {error}</div>
            </div>
        );
    }

    const filterCategories = ["all", "food_match", "expiry_alert", "nearby_food", "claim_update", "system"];

    return (
        <ErrorBoundary>
            <main className="max-w-4xl mx-auto py-8 px-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Notifications</h1>
                        {unreadCount > 0 && (
                            <p className="text-sm text-gray-500 mt-1">{unreadCount} unread</p>
                        )}
                    </div>
                    {unreadCount > 0 && (
                        <button
                            onClick={markAllAsRead}
                            className="text-sm text-[#2CABE3] hover:text-[#1a8abf] font-medium"
                        >
                            <i className="fas fa-check-double mr-1"></i>
                            Mark all as read
                        </button>
                    )}
                </div>

                {/* Category filters */}
                <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide">
                    {filterCategories.map(cat => {
                        const info = CATEGORIES[cat] || CATEGORIES.system;
                        const count = cat === "all" ? notifications.length : (categoryCounts[cat] || 0);
                        const isActive = activeFilter === cat;
                        return (
                            <button
                                key={cat}
                                onClick={() => setActiveFilter(cat)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                                    isActive
                                        ? "bg-[#2CABE3] text-white shadow-sm"
                                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                }`}
                            >
                                {info.label}
                                {count > 0 && (
                                    <span className={`text-[10px] font-bold rounded-full px-1.5 ${
                                        isActive ? "bg-white/20 text-white" : "bg-gray-200 text-gray-500"
                                    }`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Notification list */}
                <div className="space-y-3">
                    {filteredNotifications.length === 0 ? (
                        <div className="text-center py-16">
                            <i className="fas fa-bell-slash text-gray-300 text-5xl mb-4"></i>
                            <p className="text-gray-500 text-lg">No notifications{activeFilter !== "all" ? " in this category" : ""}</p>
                            <p className="text-gray-400 text-sm mt-1">We'll notify you when something matches your needs</p>
                        </div>
                    ) : (
                        filteredNotifications.map(notification => {
                            const cat = getCategoryInfo(notification.type);
                            const colors = colorMap[cat.color] || colorMap.gray;
                            const hasListingLink = notification.listing_id || notification.metadata?.listing_id;
                            const listingId = notification.listing_id || notification.metadata?.listing_id;

                            return (
                                <div
                                    key={notification.id}
                                    className={`rounded-xl border transition-all duration-200 ${
                                        notification.read
                                            ? "bg-white border-gray-100"
                                            : `bg-white border-l-4 ${colors.ring} shadow-sm`
                                    } ${!notification.read ? "border-l-[#2CABE3]" : ""}`}
                                >
                                    <div className="p-4">
                                        <div className="flex items-start gap-3">
                                            {/* Icon */}
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${colors.bg}`}>
                                                <i className={`fas ${cat.icon} ${colors.text}`}></i>
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h3 className={`font-semibold text-gray-900 ${!notification.read ? "" : "font-normal"}`}>
                                                                {notification.title}
                                                            </h3>
                                                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                                                                {cat.label}
                                                            </span>
                                                        </div>
                                                        <p className="text-gray-600 text-sm mt-0.5 line-clamp-2">
                                                            {notification.message}
                                                        </p>
                                                    </div>

                                                    {/* Time + actions */}
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <span className="text-xs text-gray-400 whitespace-nowrap">
                                                            {notification.created_at ? timeAgo(notification.created_at) : notification.time}
                                                        </span>
                                                        {!notification.read && (
                                                            <button
                                                                onClick={() => handleMarkAsRead(notification.id)}
                                                                className="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-green-500 transition-colors"
                                                                title="Mark as read"
                                                            >
                                                                <i className="fas fa-check text-xs"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* CTA button for food matches */}
                                                {hasListingLink && (
                                                    <button
                                                        onClick={() => navigate(`/find-food?listing=${listingId}`)}
                                                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-[#2CABE3] text-white text-xs font-medium rounded-full hover:bg-[#1a8abf] transition-colors"
                                                    >
                                                        <i className="fas fa-hand-holding-heart"></i>
                                                        Claim Now
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </main>
        </ErrorBoundary>
    );
}

export default Notifications;
