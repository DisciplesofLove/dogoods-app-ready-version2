import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTutorial } from '../../utils/TutorialContext';

// ─── Step Definitions ───────────────────────────────────────────────
// category: null = included in full tour; otherwise only shown when that category is active
const ALL_STEPS = [
    // ── Welcome ──
    {
        id: 'welcome',
        category: null,
        target: null,
        icon: 'fa-seedling',
        title: 'Welcome to DoGoods!',
        content: 'DoGoods connects families with free food and resources in Alameda County. Let\'s walk through the platform together — it only takes a minute.',
        placement: 'center',
        route: null
    },

    // ── Navigation ──
    {
        id: 'nav-find',
        category: 'navigation',
        target: '[href="/find"]',
        icon: 'fa-search',
        title: 'Find Food',
        content: 'Browse available food items shared by the community. Filter by category, distance, or dietary needs and claim what your family needs.',
        placement: 'bottom',
        route: null
    },
    {
        id: 'nav-support',
        category: 'navigation',
        target: null,
        icon: 'fa-hand-holding-heart',
        title: 'Support Us',
        content: 'Under "Support Us" you can donate to help the foundation or volunteer your time. Every contribution helps feed families in our community.',
        placement: 'center',
        route: null
    },
    {
        id: 'nav-impact',
        category: 'navigation',
        target: '[href="/impact-story"]',
        icon: 'fa-chart-line',
        title: 'Impact Story',
        content: 'Read about the real-world impact of our community through blog posts, news updates, and testimonials from families we\'ve helped.',
        placement: 'bottom',
        route: null
    },
    {
        id: 'nav-recipes',
        category: 'navigation',
        target: '[href="/recipes"]',
        icon: 'fa-utensils',
        title: 'Recipes',
        content: 'Discover budget-friendly recipes that help you make the most of available food. Created by and for the community.',
        placement: 'bottom',
        route: null
    },
    {
        id: 'nav-sponsors',
        category: 'navigation',
        target: '[href="/sponsors"]',
        icon: 'fa-building',
        title: 'Sponsors',
        content: 'Meet the organizations and businesses that make DoGoods possible through their generous sponsorship.',
        placement: 'bottom',
        route: null
    },
    {
        id: 'nav-contact',
        category: 'navigation',
        target: '[href="/contact"]',
        icon: 'fa-envelope',
        title: 'Contact',
        content: 'Have questions or need help? Reach out to the All Good Living Foundation team through the contact page.',
        placement: 'bottom',
        route: null
    },

    // ── Account ──
    {
        id: 'account-actions',
        category: 'account',
        target: '[data-name="user-actions"]',
        icon: 'fa-user-circle',
        title: 'Your Account',
        content: 'Click your avatar to access your Dashboard, Profile, Listings, and Settings. This is your personal hub.',
        placement: 'bottom',
        route: null,
        requiresAuth: true
    },
    {
        id: 'account-signin',
        category: 'account',
        target: null,
        icon: 'fa-sign-in-alt',
        title: 'Sign In / Sign Up',
        content: 'Create a free account or sign in to access your dashboard, claim food, track your impact, and connect with the community.',
        placement: 'center',
        route: null,
        requiresAuth: false,
        hideIfAuth: true
    },

    // ── Finding Food ──
    {
        id: 'food-browse',
        category: 'food',
        target: null,
        icon: 'fa-search',
        title: 'Browse Available Food',
        content: 'The Find Food page shows all currently available items. Each listing includes the food type, quantity, location, and expiration details.',
        placement: 'center',
        route: '/find'
    },
    {
        id: 'food-claim',
        category: 'food',
        target: null,
        icon: 'fa-hand-pointer',
        title: 'Claiming Items',
        content: 'When you find something you need, click "Claim" to reserve it. You\'ll receive pickup details and can track your claim in your dashboard.',
        placement: 'center',
        route: null
    },

    // ── Community ──
    {
        id: 'community-overview',
        category: 'community',
        target: null,
        icon: 'fa-users',
        title: 'Communities',
        content: 'DoGoods serves multiple communities across Alameda County. Each community hub has its own food access programs, events, and resources.',
        placement: 'center',
        route: null
    },
    {
        id: 'community-events',
        category: 'community',
        target: null,
        icon: 'fa-calendar-alt',
        title: 'Community Hubs',
        content: 'Visit your community page to find food access programs, connect with neighbors, and learn about local resources. Each community has its own hub.',
        placement: 'center',
        route: null
    },

    // ── Dashboard ──
    {
        id: 'dashboard-overview',
        category: 'dashboard',
        target: null,
        icon: 'fa-tachometer-alt',
        title: 'Your Dashboard',
        content: 'Your dashboard shows your food claim receipts, recent activity, and quick actions like finding food or setting up donation schedules.',
        placement: 'center',
        route: '/dashboard',
        requiresAuth: true
    },

    // ── How to help ──
    {
        id: 'help-donate',
        category: 'helping',
        target: null,
        icon: 'fa-donate',
        title: 'Donate',
        content: 'Financial donations help purchase food, supplies, and run distribution events. Even small amounts make a big difference.',
        placement: 'center',
        route: '/donate'
    },
    {
        id: 'help-volunteer',
        category: 'helping',
        target: null,
        icon: 'fa-hands-helping',
        title: 'Volunteer',
        content: 'Volunteers are the backbone of DoGoods. Help at distribution events, sort donations, or assist with community outreach.',
        placement: 'center',
        route: null
    },

    // ── Completion ──
    {
        id: 'complete',
        category: null,
        target: null,
        icon: 'fa-check-circle',
        title: 'You\'re All Set!',
        content: 'You now know how to navigate DoGoods. Click the help button (?) in the header anytime to restart this tour or learn about specific sections.',
        placement: 'center',
        route: null
    }
];

// ─── Category meta for the category picker ─────────────────────────
const CATEGORIES = [
    { id: null,          label: 'Full Tour',        icon: 'fa-route',              description: 'Complete walkthrough of the platform' },
    { id: 'navigation',  label: 'Navigation',       icon: 'fa-compass',            description: 'Learn the main menu & pages' },
    { id: 'food',        label: 'Finding Food',     icon: 'fa-apple-alt',          description: 'How to find & claim food' },
    { id: 'community',   label: 'Community',        icon: 'fa-users',              description: 'Communities & events' },
    { id: 'account',     label: 'Your Account',     icon: 'fa-user-circle',        description: 'Dashboard, profile & settings' },
    { id: 'helping',     label: 'How to Help',      icon: 'fa-hands-helping',      description: 'Donating & volunteering' }
];

// ─── Component ──────────────────────────────────────────────────────
function Tutorial() {
    const {
        isTutorialOpen,
        currentStepIndex,
        activeCategory,
        closeTutorial,
        completeTutorial,
        nextStep,
        prevStep,
        goToStep,
        startTutorial
    } = useTutorial();

    const navigate = useNavigate();
    const location = useLocation();
    const [highlightRect, setHighlightRect] = useState(null);
    const [showCategoryPicker, setShowCategoryPicker] = useState(false);
    const tooltipRef = useRef(null);
    const resizeTimerRef = useRef(null);

    // Filter steps based on active category
    const steps = React.useMemo(() => {
        if (activeCategory === null) {
            // Full tour: include steps that have no category OR steps from all categories
            return ALL_STEPS;
        }
        // Category tour: welcome + category steps + complete
        const welcome = ALL_STEPS.find(s => s.id === 'welcome');
        const complete = ALL_STEPS.find(s => s.id === 'complete');
        const categorySteps = ALL_STEPS.filter(s => s.category === activeCategory);
        return [welcome, ...categorySteps, complete];
    }, [activeCategory]);

    const currentStep = steps[currentStepIndex] || steps[0];
    const isFirstStep = currentStepIndex === 0;
    const isLastStep = currentStepIndex === steps.length - 1;

    // Highlight target element
    const updateHighlight = useCallback(() => {
        if (!isTutorialOpen || !currentStep?.target) {
            setHighlightRect(null);
            return;
        }
        const el = document.querySelector(currentStep.target);
        if (el) {
            const rect = el.getBoundingClientRect();
            setHighlightRect({
                top: rect.top - 8,
                left: rect.left - 8,
                width: rect.width + 16,
                height: rect.height + 16
            });
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            setHighlightRect(null);
        }
    }, [isTutorialOpen, currentStep]);

    useEffect(() => {
        updateHighlight();
        // Also recalculate on resize/scroll
        const handleReposition = () => {
            clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = setTimeout(updateHighlight, 100);
        };
        window.addEventListener('resize', handleReposition);
        window.addEventListener('scroll', handleReposition, true);
        return () => {
            window.removeEventListener('resize', handleReposition);
            window.removeEventListener('scroll', handleReposition, true);
            clearTimeout(resizeTimerRef.current);
        };
    }, [updateHighlight]);

    // Navigate to required route if step requests it
    useEffect(() => {
        if (!isTutorialOpen || !currentStep?.route) return;
        if (location.pathname !== currentStep.route) {
            navigate(currentStep.route);
        }
    }, [isTutorialOpen, currentStep, location.pathname, navigate]);

    if (!isTutorialOpen) return null;

    const handleNext = () => {
        if (isLastStep) {
            completeTutorial();
        } else {
            nextStep();
        }
    };

    const handlePrevious = () => {
        if (!isFirstStep) prevStep();
    };

    const handleSkip = () => {
        closeTutorial();
    };

    const handleSelectCategory = (catId) => {
        setShowCategoryPicker(false);
        startTutorial(catId);
    };

    // Tooltip positioning
    const getTooltipStyle = () => {
        if (!highlightRect || currentStep?.placement === 'center') {
            return {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                maxWidth: '520px',
                width: '92%'
            };
        }

        const style = {
            position: 'fixed',
            maxWidth: '420px',
            width: '92%',
            zIndex: 10001
        };

        const viewH = window.innerHeight;
        const viewW = window.innerWidth;
        const spaceBelow = viewH - (highlightRect.top + highlightRect.height);
        const spaceAbove = highlightRect.top;

        // Prefer below, then above, then center
        if (spaceBelow > 200) {
            style.top = `${highlightRect.top + highlightRect.height + 16}px`;
            style.left = `${Math.min(Math.max(highlightRect.left + highlightRect.width / 2, 220), viewW - 220)}px`;
            style.transform = 'translateX(-50%)';
        } else if (spaceAbove > 200) {
            style.bottom = `${viewH - highlightRect.top + 16}px`;
            style.left = `${Math.min(Math.max(highlightRect.left + highlightRect.width / 2, 220), viewW - 220)}px`;
            style.transform = 'translateX(-50%)';
        } else {
            style.top = '50%';
            style.left = '50%';
            style.transform = 'translate(-50%, -50%)';
        }

        return style;
    };

    // ─── Category picker screen ─────────────────────────────────────
    if (showCategoryPicker) {
        return (
            <>
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]" onClick={() => setShowCategoryPicker(false)} />
                <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-fadeIn">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-xl font-bold text-gray-900">Choose a Guide</h3>
                            <button onClick={() => setShowCategoryPicker(false)} className="text-gray-400 hover:text-gray-600 text-lg">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <p className="text-gray-500 text-sm mb-5">Pick a section to learn about, or take the full tour.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id || 'full'}
                                    onClick={() => handleSelectCategory(cat.id)}
                                    className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-[#2CABE3] hover:bg-[#2CABE3]/5 transition-all text-left group"
                                >
                                    <div className="w-10 h-10 rounded-lg bg-[#2CABE3]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#2CABE3]/20 transition-colors">
                                        <i className={`fas ${cat.icon} text-[#2CABE3]`}></i>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-900 text-sm">{cat.label}</div>
                                        <div className="text-xs text-gray-500 mt-0.5">{cat.description}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <style>{tutorialStyles}</style>
            </>
        );
    }

    // ─── Main tutorial UI ───────────────────────────────────────────
    return (
        <>
            {/* Overlay */}
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] transition-opacity" onClick={handleSkip} />

            {/* Spotlight */}
            {highlightRect && (
                <div
                    className="fixed pointer-events-none z-[10000] tutorial-spotlight"
                    style={{
                        top: `${highlightRect.top}px`,
                        left: `${highlightRect.left}px`,
                        width: `${highlightRect.width}px`,
                        height: `${highlightRect.height}px`,
                        border: '3px solid #2CABE3',
                        borderRadius: '12px',
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55), 0 0 30px rgba(44, 171, 227, 0.4)',
                    }}
                />
            )}

            {/* Tooltip card */}
            <div
                ref={tooltipRef}
                className="bg-white rounded-2xl shadow-2xl z-[10001] animate-fadeIn overflow-hidden"
                style={getTooltipStyle()}
            >
                {/* Icon header bar */}
                <div className="bg-gradient-to-r from-[#2CABE3] to-[#1b8dbf] px-6 py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                        <i className={`fas ${currentStep.icon || 'fa-info-circle'} text-white text-lg`}></i>
                    </div>
                    <div className="flex-grow">
                        <h3 className="text-lg font-bold text-white">{currentStep.title}</h3>
                    </div>
                    <button
                        onClick={handleSkip}
                        className="text-white/70 hover:text-white transition-colors"
                        aria-label="Close tutorial"
                    >
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-gray-600 leading-relaxed mb-5">{currentStep.content}</p>

                    {/* Step dots */}
                    <div className="flex items-center justify-center gap-1.5 mb-5">
                        {steps.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => goToStep(i)}
                                className={`rounded-full transition-all duration-300 ${
                                    i === currentStepIndex
                                        ? 'w-6 h-2.5 bg-[#2CABE3]'
                                        : i < currentStepIndex
                                        ? 'w-2.5 h-2.5 bg-[#2CABE3]/40'
                                        : 'w-2.5 h-2.5 bg-gray-200'
                                }`}
                                aria-label={`Go to step ${i + 1}`}
                            />
                        ))}
                    </div>

                    {/* Progress text */}
                    <div className="text-xs text-gray-400 text-center mb-4">
                        Step {currentStepIndex + 1} of {steps.length}
                        {activeCategory && (
                            <span className="ml-2 text-[#2CABE3]">
                                &middot; {CATEGORIES.find(c => c.id === activeCategory)?.label || 'Full Tour'}
                            </span>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSkip}
                                className="text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors"
                            >
                                Skip
                            </button>
                            <button
                                onClick={() => setShowCategoryPicker(true)}
                                className="text-[#2CABE3] hover:text-[#1b8dbf] text-sm font-medium transition-colors flex items-center gap-1"
                            >
                                <i className="fas fa-th-large text-xs"></i>
                                Sections
                            </button>
                        </div>
                        <div className="flex gap-2">
                            {!isFirstStep && (
                                <button
                                    onClick={handlePrevious}
                                    className="px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium text-sm text-gray-700 transition-colors"
                                >
                                    <i className="fas fa-arrow-left mr-1 text-xs"></i>
                                    Back
                                </button>
                            )}
                            <button
                                onClick={handleNext}
                                className="px-5 py-2 bg-[#2CABE3] text-white rounded-xl hover:bg-[#1b8dbf] font-medium text-sm transition-colors shadow-sm"
                            >
                                {isLastStep ? (
                                    <>Finish <i className="fas fa-check ml-1 text-xs"></i></>
                                ) : (
                                    <>Next <i className="fas fa-arrow-right ml-1 text-xs"></i></>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <style>{tutorialStyles}</style>
        </>
    );
}

const tutorialStyles = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    .animate-fadeIn {
        animation: fadeIn 0.25s ease-out;
    }
    .tutorial-spotlight {
        animation: spotlightPulse 2s ease-in-out infinite;
    }
    @keyframes spotlightPulse {
        0%, 100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), 0 0 30px rgba(44,171,227,0.4); }
        50%      { box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), 0 0 40px rgba(44,171,227,0.6); }
    }
`;

export default Tutorial;
