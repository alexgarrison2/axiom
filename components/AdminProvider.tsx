"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';

interface AdminContextProps {
    isAdmin: boolean;
    setIsAdmin: (val: boolean) => void;
}

const AdminContext = createContext<AdminContextProps>({
    isAdmin: false,
    setIsAdmin: () => { },
});

export const useAdmin = () => useContext(AdminContext);

export const AdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            // Check session storage first
            const stored = sessionStorage.getItem('isAdmin');
            if (stored === 'true') {
                setIsAdmin(true);
            }

            // Check URL
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('admin') === 'pony') {
                setIsAdmin(true);
                sessionStorage.setItem('isAdmin', 'true');
            }

            // Global keydown listener for Cmd+Shift+" (or Ctrl+Shift+")
            const handleKeyDown = (e: KeyboardEvent) => {
                if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '"' || e.code === 'Quote')) {
                    e.preventDefault();
                    setIsAdmin(prev => {
                        const nextVal = !prev;
                        sessionStorage.setItem('isAdmin', String(nextVal));
                        return nextVal;
                    });
                }
            };

            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }
    }, []);

    return (
        <AdminContext.Provider value={{ isAdmin, setIsAdmin }}>
            {children}
        </AdminContext.Provider>
    );
};
