import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SearchX, Home } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="p-6 md:p-8 max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-muted mb-4">
          <SearchX className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Page Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/">
          <Button className="bg-emerald-600 hover:bg-emerald-700">
            <Home className="h-4 w-4 mr-1.5" />
            Back to Dashboard
          </Button>
        </Link>
      </Card>
    </div>
  )
}
