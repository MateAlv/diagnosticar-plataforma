'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const MICROIN_PUBLIC_URL =
  process.env.NEXT_PUBLIC_MICROIN_URL ?? 'http://localhost:11001';

export default function MicroinPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!loading && user?.permissions?.microin) {
      window.location.href = MICROIN_PUBLIC_URL;
    }
  }, [loading, user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading MicroIN...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  if (!user.permissions?.microin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600">Access Denied</p>
          <p className="text-gray-600 mt-2">
            You do not have permission to access MicroIN.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="text-center space-y-4">
        <p className="text-sm uppercase tracking-widest text-white/70">Redirecting to MicroIN</p>
        <p className="text-base">
          If the redirect does not happen automatically,&nbsp;
          <a
            href={MICROIN_PUBLIC_URL}
            className="text-blue-300 underline hover:text-blue-200"
          >
            click here
          </a>
          .
        </p>
        <a
          href={MICROIN_PUBLIC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline inline-flex items-center h-10 px-4 rounded-md"
        >
          Open MicroIN in new tab
        </a>
      </div>
    </div>
  );
}
