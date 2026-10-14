import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="py-20 flex items-center justify-center">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold text-zinc-100">Page Not Found</h2>
        <p className="text-xs text-zinc-400">
          The requested page does not exist or has been moved.
        </p>
        <div className="pt-2">
          <Link to="/">
            <Button size="sm">Return to Overview</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
};
