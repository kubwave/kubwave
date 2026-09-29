import { redirect } from 'next/navigation';

// The project list lives on the home page; this URL stays for old links.
export default function ProjectsPage() {
	redirect('/');
}
