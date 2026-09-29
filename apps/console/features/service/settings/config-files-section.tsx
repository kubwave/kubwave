'use client';

import { FileTextIcon, PlusIcon } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Service } from '@/lib/api/types';
import { rowId } from '@/lib/service-settings';
import { CodeEditor, referenceCompletions } from '../code-editor';
import { FieldError, Group, RemoveRowButton, replaceAt, type SectionProps } from './fields';

export function ConfigFilesSection({ values, errors, set, services }: SectionProps & { services: Service[] }) {
	// The completion source reads names through a ref, so editors are not rebuilt when services change.
	const names = useRef<string[]>([]);
	names.current = services.map(service => service.name);
	const completions = useMemo(() => referenceCompletions(() => names.current), []);

	return (
		<Group
			description={
				<>
					Rendered and mounted into the container at the given path, encrypted at rest. Type <code className="font-mono">{'${{'}</code> to reference
					another service; references resolve on every deploy.
				</>
			}
		>
			<FieldError message={errors.configFiles} />
			{values.configFiles.map((file, index) => (
				<div key={file._id} className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="relative flex-1">
							<FileTextIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={file.path}
								onChange={event => set({ configFiles: replaceAt(values.configFiles, index, { path: event.target.value }) })}
								placeholder="/etc/app/config.yml"
								className="h-8 pl-8 font-mono text-xs"
								aria-label="File path"
								aria-invalid={errors[`configFiles.${index}.path`] ? true : undefined}
							/>
						</div>
						<RemoveRowButton
							label={`Remove ${file.path || 'config file'}`}
							onClick={() => set({ configFiles: values.configFiles.filter((_, i) => i !== index) })}
						/>
					</div>
					<FieldError message={errors[`configFiles.${index}.path`]} />
					<CodeEditor
						value={file.content}
						onChange={content => set({ configFiles: replaceAt(values.configFiles, index, { content }) })}
						completions={completions}
						className="h-48"
						aria-label={`Contents of ${file.path || 'config file'}`}
					/>
				</div>
			))}
			<Button
				variant="outline"
				size="sm"
				className="w-fit"
				onClick={() => set({ configFiles: [...values.configFiles, { _id: rowId(), path: '', content: '' }] })}
			>
				<PlusIcon /> Add config file
			</Button>
		</Group>
	);
}
