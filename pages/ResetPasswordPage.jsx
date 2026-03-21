import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import supabase from '../utils/supabaseClient';
import { reportError } from '../utils/helpers';

function ResetPasswordPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [formData, setFormData] = React.useState({
        password: '',
        confirmPassword: ''
    });
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [success, setSuccess] = React.useState(false);
    const [showPassword, setShowPassword] = React.useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
    const [verifyingToken, setVerifyingToken] = React.useState(true);
    const [validToken, setValidToken] = React.useState(false);
    const resolvedRef = useRef(false);

    useEffect(() => {
        let isMounted = true;

        const resolve = (valid, errorMsg = null) => {
            if (resolvedRef.current || !isMounted) return;
            resolvedRef.current = true;
            console.log(`🔑 Reset page resolved: valid=${valid}`, errorMsg || '');
            setValidToken(valid);
            setVerifyingToken(false);
            if (errorMsg) setError(errorMsg);
        };

        // Check if user arrived via OTP verification (already has session)
        const isOtpVerified = searchParams.get('verified') === 'true';

        // Check if URL has recovery indicators BEFORE Supabase consumes them
        const hash = window.location.hash || '';
        const hasRecoveryHash = hash.includes('type=recovery') || hash.includes('access_token');
        const hasCode = searchParams.get('code');
        const hasToken = searchParams.get('token');
        const hasRecoveryParams = hasRecoveryHash || hasCode || hasToken || isOtpVerified;

        console.log('🔑 Reset page: checking URL params', { hasRecoveryHash, hasCode, hasToken, isOtpVerified });

        // If user came from OTP verification, check for existing session immediately
        if (isOtpVerified) {
            (async () => {
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session) {
                        resolve(true);
                    } else {
                        resolve(false, 'Session expired. Please request a new password reset.');
                    }
                } catch {
                    resolve(false, 'Session verification failed. Please try again.');
                }
            })();
            return () => { isMounted = false; };
        }

        // Listen for Supabase auth events (detectSessionInUrl will fire these)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            console.log('🔑 Reset page auth event:', event);
            if (event === 'PASSWORD_RECOVERY') {
                resolve(true);
            } else if (event === 'SIGNED_IN' && session) {
                // Supabase may fire SIGNED_IN for recovery flows
                resolve(true);
            } else if (event === 'TOKEN_REFRESHED' && session) {
                resolve(true);
            }
        });

        if (hasRecoveryParams) {
            // Recovery params detected - Supabase's detectSessionInUrl will process them.
            // Wait for the auth event, with a fallback session check after delay.
            const fallbackTimeout = setTimeout(async () => {
                if (resolvedRef.current) return;
                console.log('🔑 Reset page: fallback session check...');
                try {
                    // Race getSession against a 10s timeout
                    const sessionPromise = supabase.auth.getSession();
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Session check timed out')), 10000)
                    );
                    const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
                    if (session) {
                        resolve(true);
                    } else {
                        resolve(false, 'Reset link verification timed out. Please request a new link.');
                    }
                } catch {
                    resolve(false, 'Reset link may have expired. Please request a new password reset.');
                }
            }, 3000);

            return () => {
                isMounted = false;
                subscription.unsubscribe();
                clearTimeout(fallbackTimeout);
            };
        } else {
            // No recovery params in URL at all - invalid direct navigation
            resolve(false, 'Invalid or expired reset link. Please request a new password reset.');

            return () => {
                isMounted = false;
                subscription.unsubscribe();
            };
        }
    }, [searchParams]);

    const validatePassword = (password) => {
        if (password.length < 8) {
            return 'Password must be at least 8 characters long';
        }
        if (!/(?=.*[a-z])/.test(password)) {
            return 'Password must contain at least one lowercase letter';
        }
        if (!/(?=.*[A-Z])/.test(password)) {
            return 'Password must contain at least one uppercase letter';
        }
        if (!/(?=.*\d)/.test(password)) {
            return 'Password must contain at least one number';
        }
        return null;
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
        if (error) setError(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!formData.password || !formData.confirmPassword) {
            setError('Please fill in all fields');
            return;
        }

        const passwordError = validatePassword(formData.password);
        if (passwordError) {
            setError(passwordError);
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);

        try {
            // Update password using Supabase
            const { error: updateError } = await supabase.auth.updateUser({
                password: formData.password
            });

            if (updateError) {
                throw updateError;
            }

            setSuccess(true);
            
            // Sign out after password reset for security
            await supabase.auth.signOut();
            
            setTimeout(() => {
                navigate('/login?message=password-reset-success');
            }, 2000);
        } catch (error) {
            console.error('Password update error:', error);
            reportError(error, { context: 'Password reset' });
            
            if (error.message?.includes('session') || error.message?.includes('token')) {
                setError('Your reset link has expired. Please request a new one.');
                setTimeout(() => navigate('/forgot-password'), 3000);
            } else if (error.message?.includes('same password')) {
                setError('New password must be different from your old password.');
            } else {
                setError('Failed to reset password. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    // Show loading while verifying token
    if (verifyingToken) {
        return (
            <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto mb-4"></div>
                            <p className="text-sm text-gray-600">Verifying reset link...</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Show error if token is invalid
    if (!validToken && !verifyingToken) {
        return (
            <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                        <div className="text-center">
                            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
                                <i className="fas fa-times text-red-600 text-xl"></i>
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">
                                Invalid or Expired Link
                            </h3>
                            <p className="text-sm text-gray-600 mb-6">
                                {error || 'This password reset link is invalid or has expired.'}
                            </p>
                            <div className="space-y-3">
                                <Button
                                    variant="primary"
                                    onClick={() => navigate('/forgot-password')}
                                    className="w-full"
                                >
                                    Request New Reset Link
                                </Button>
                                <button
                                    onClick={() => navigate('/login')}
                                    className="w-full text-sm font-medium text-primary-600 hover:text-primary-500"
                                >
                                    Back to Login
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                        <div className="text-center">
                            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-primary-100 mb-4">
                                <i className="fas fa-check text-primary-600 text-xl"></i>
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">
                                Password reset successful
                            </h3>
                            <p className="text-sm text-gray-600 mb-6">
                                Your password has been successfully reset. You can now log in with your new password.
                            </p>
                            <p className="text-sm text-gray-500">
                                Redirecting to login page...
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    Set new password
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Please enter your new password below
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                New password
                            </label>
                            <div className="mt-1 relative">
                                <Input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                    required
                                    value={formData.password}
                                    onChange={handleChange}
                                    placeholder="Enter new password"
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                                >
                                    <i className={`fas fa-eye${showPassword ? '-slash' : ''} text-gray-400`}></i>
                                </button>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                                Must be at least 8 characters with uppercase, lowercase, and numbers
                            </p>
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                                Confirm new password
                            </label>
                            <div className="mt-1 relative">
                                <Input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                    required
                                    value={formData.confirmPassword}
                                    onChange={handleChange}
                                    placeholder="Confirm new password"
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                                >
                                    <i className={`fas fa-eye${showConfirmPassword ? '-slash' : ''} text-gray-400`}></i>
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-md bg-red-50 p-4">
                                <div className="flex">
                                    <div className="flex-shrink-0">
                                        <i className="fas fa-exclamation-circle text-red-400"></i>
                                    </div>
                                    <div className="ml-3">
                                        <p className="text-sm text-red-800">{error}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div>
                            <Button
                                type="submit"
                                variant="primary"
                                className="w-full"
                                disabled={loading}
                            >
                                {loading ? 'Resetting password...' : 'Reset password'}
                            </Button>
                        </div>

                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="text-sm font-medium text-primary-600 hover:text-primary-500"
                            >
                                Back to login
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default ResetPasswordPage;
