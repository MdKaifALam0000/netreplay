import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sliders,
  Plus,
  Search,
  Trash2,
  Edit2,
  Play,
  Clock,
  Layers,
  Tag,
  AlertCircle,
} from 'lucide-react';
import {
  useProfiles,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile,
  useStartRun,
} from '../api/hooks';
import type { Profile, CreateProfileInput } from '../types/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Dialog } from '../components/ui/Dialog';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';

export const ProfilesPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRequestCount, setFormRequestCount] = useState(10);
  const [formTimeoutMs, setFormTimeoutMs] = useState(5000);
  const [formFaultType, setFormFaultType] = useState<'latency' | 'timeout' | 'bandwidth' | 'reset'>('latency');
  const [formLatencyMs, setFormLatencyMs] = useState(250);
  const [formJitterMs, setFormJitterMs] = useState(25);
  const [formTimeoutDuration, setFormTimeoutDuration] = useState(1000);
  const [formBandwidthRate, setFormBandwidthRate] = useState(100);
  const [formStream, setFormStream] = useState<'downstream' | 'upstream'>('downstream');
  const [formTags, setFormTags] = useState('smoke, demo');

  const { data, isLoading, error } = useProfiles({ limit: 50, tag: tagFilter || undefined });
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const deleteProfile = useDeleteProfile();
  const startRun = useStartRun();

  const { toast } = useToast();
  const navigate = useNavigate();

  const profiles = data?.items || [];
  const filteredProfiles = profiles.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormRequestCount(10);
    setFormTimeoutMs(5000);
    setFormFaultType('latency');
    setFormLatencyMs(250);
    setFormJitterMs(25);
    setFormTimeoutDuration(1000);
    setFormBandwidthRate(100);
    setFormStream('downstream');
    setFormTags('smoke, demo');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (p: Profile) => {
    setEditingProfile(p);
    setFormName(p.name);
    setFormDescription(p.description || '');
    setFormRequestCount(p.requestCount);
    setFormTimeoutMs(p.requestTimeoutMs);
    setFormTags(p.tags?.join(', ') || '');
    if (p.faults && p.faults.length > 0) {
      const f = p.faults[0];
      setFormFaultType(f.type === 'reset_peer' ? 'reset' : f.type);
      setFormStream(f.stream || 'downstream');
      if (f.type === 'latency') {
        setFormLatencyMs(f.latencyMs);
        setFormJitterMs(f.jitterMs || 0);
      } else if (f.type === 'timeout') {
        setFormTimeoutDuration(f.timeoutMs);
      } else if (f.type === 'bandwidth') {
        setFormBandwidthRate(f.rateKbps);
      }
    }
  };

  const buildFaultPayload = () => {
    if (formFaultType === 'latency') {
      return [{
        type: 'latency' as const,
        latencyMs: Number(formLatencyMs),
        jitterMs: Number(formJitterMs) || 0,
        stream: formStream,
        toxicity: 1.0,
      }];
    }
    if (formFaultType === 'timeout') {
      return [{
        type: 'timeout' as const,
        timeoutMs: Number(formTimeoutDuration),
        stream: formStream,
        toxicity: 1.0,
      }];
    }
    if (formFaultType === 'bandwidth') {
      return [{
        type: 'bandwidth' as const,
        rateKbps: Number(formBandwidthRate),
        stream: formStream,
        toxicity: 1.0,
      }];
    }
    return [{
      type: 'reset' as const,
      stream: formStream,
      toxicity: 1.0,
    }];
  };

  const handleCreateSubmit = async () => {
    if (!formName.trim()) {
      toast({ title: 'Validation Error', message: 'Profile name is required.', type: 'error' });
      return;
    }
    try {
      const payload: CreateProfileInput = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        engine: 'toxiproxy',
        target: 'local-test-target',
        requestCount: Number(formRequestCount),
        requestTimeoutMs: Number(formTimeoutMs),
        faults: buildFaultPayload(),
        tags: formTags.split(',').map((t) => t.trim()).filter(Boolean),
      };

      await createProfile.mutateAsync(payload);
      toast({ title: 'Profile Created', message: `Profile "${formName}" saved successfully.`, type: 'success' });
      setIsCreateOpen(false);
      resetForm();
    } catch (err: any) {
      toast({ title: 'Failed to Create Profile', message: err.message, type: 'error' });
    }
  };

  const handleEditSubmit = async () => {
    if (!editingProfile) return;
    if (!formName.trim()) {
      toast({ title: 'Validation Error', message: 'Profile name is required.', type: 'error' });
      return;
    }
    try {
      await updateProfile.mutateAsync({
        id: editingProfile.id,
        data: {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          requestCount: Number(formRequestCount),
          requestTimeoutMs: Number(formTimeoutMs),
          faults: buildFaultPayload(),
          tags: formTags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      });
      toast({ title: 'Profile Updated', message: `Profile "${formName}" updated successfully.`, type: 'success' });
      setEditingProfile(null);
    } catch (err: any) {
      toast({ title: 'Failed to Update Profile', message: err.message, type: 'error' });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProfile) return;
    try {
      await deleteProfile.mutateAsync(deletingProfile.id);
      toast({ title: 'Profile Deleted', message: `Profile "${deletingProfile.name}" was deleted.`, type: 'success' });
      setDeletingProfile(null);
    } catch (err: any) {
      toast({
        title: 'Delete Failed',
        message: err.message || 'Cannot delete profile while active runs are associated with it.',
        type: 'error',
      });
    }
  };

  const handleLaunchRun = async (profileId: string, name: string) => {
    try {
      const run = await startRun.mutateAsync(profileId);
      toast({
        title: 'Run Started',
        message: `Execution queued for profile "${name}"`,
        type: 'success',
      });
      navigate(`/runs/${run.id}`);
    } catch (err: any) {
      toast({ title: 'Launch Failed', message: err.message, type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            Experiment Profiles
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Reusable network fault templates configured for the local test target.
          </p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={handleOpenCreate}>
          Create Profile
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search profiles by name or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface-raised border border-surface-border text-xs text-zinc-100 rounded-lg pl-9 pr-3 py-2 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {tagFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Filtering tag:</span>
            <Badge variant="indigo" className="cursor-pointer" onClick={() => setTagFilter('')}>
              {tagFilter} ✕
            </Badge>
          </div>
        )}
      </div>

      {/* Profiles Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : error ? (
        <Card className="p-8 text-center text-rose-400 border-rose-900/40 bg-rose-950/20">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
          <p className="font-semibold text-sm">Failed to load profiles</p>
          <p className="text-xs text-zinc-400 mt-1">{(error as any).message}</p>
        </Card>
      ) : filteredProfiles.length === 0 ? (
        <Card className="p-12 text-center text-zinc-400">
          <Sliders className="w-10 h-10 mx-auto text-zinc-600 mb-3" />
          <h3 className="text-sm font-semibold text-zinc-200">No profiles found</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            {searchTerm
              ? `No profile matches "${searchTerm}".`
              : 'Create an experiment profile to test latency, timeouts, bandwidth limits, or TCP resets.'}
          </p>
          <div className="mt-4">
            <Button size="sm" onClick={handleOpenCreate} icon={<Plus className="w-4 h-4" />}>
              Create Profile
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProfiles.map((p) => {
            const faultSummary = p.faults
              .map((f) => {
                if (f.type === 'latency') return `+${f.latencyMs}ms latency (jitter: ${f.jitterMs || 0}ms)`;
                if (f.type === 'timeout') return `${f.timeoutMs}ms connection stall`;
                if (f.type === 'bandwidth') return `${f.rateKbps} KB/s rate limit`;
                return 'TCP RST (reset peer)';
              })
              .join('; ');

            return (
              <Card
                key={p.id}
                className="flex flex-col justify-between hover:border-zinc-700 transition-colors"
              >
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-zinc-100 truncate">{p.name}</h3>
                    <Badge variant="blue" size="sm">
                      {p.engine}
                    </Badge>
                  </div>

                  {p.description && (
                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                      {p.description}
                    </p>
                  )}

                  <div className="space-y-1.5 pt-2 border-t border-surface-border text-xs">
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="font-mono text-[11px] text-indigo-300 truncate font-semibold">
                        {faultSummary || 'No faults (Clean baseline)'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                        {p.requestCount} reqs @ {p.requestTimeoutMs}ms timeout
                      </span>
                      <span className="font-mono text-zinc-500">
                        {p.target?.path || '/api/demo'}
                      </span>
                    </div>
                  </div>

                  {/* Tags */}
                  {p.tags && p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {p.tags.map((tag) => (
                        <span
                          key={tag}
                          onClick={() => setTagFilter(tag)}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-white cursor-pointer hover:bg-zinc-700 transition-colors"
                        >
                          <Tag className="w-2.5 h-2.5 text-zinc-500" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card Actions Footer */}
                <div className="px-5 py-3 bg-surface border-t border-surface-border flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenEdit(p)}
                      title="Edit Profile"
                      className="p-1.5 h-8 w-8 text-zinc-400 hover:text-zinc-200"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeletingProfile(p)}
                      title="Delete Profile"
                      className="p-1.5 h-8 w-8 text-zinc-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Play className="w-3.5 h-3.5" />}
                    onClick={() => handleLaunchRun(p.id, p.name)}
                    isLoading={startRun.isPending}
                  >
                    Run
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal Form */}
      <Dialog
        isOpen={isCreateOpen || editingProfile !== null}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingProfile(null);
        }}
        title={editingProfile ? 'Edit Profile' : 'Create Experiment Profile'}
        description="Configure target probes and network faults"
        confirmLabel={editingProfile ? 'Save Changes' : 'Create Profile'}
        onConfirm={editingProfile ? handleEditSubmit : handleCreateSubmit}
        isConfirmLoading={createProfile.isPending || updateProfile.isPending}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <Input
            label="Profile Name"
            required
            placeholder="e.g. 500ms Downstream Latency Spike"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />

          <Input
            label="Description (Optional)"
            placeholder="Document why this profile exists and what failure scenario it recreates"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Request Count (1 - 100)"
              type="number"
              min={1}
              max={100}
              value={formRequestCount}
              onChange={(e) => setFormRequestCount(Number(e.target.value))}
            />
            <Input
              label="Request Timeout (ms)"
              type="number"
              min={100}
              max={30000}
              value={formTimeoutMs}
              onChange={(e) => setFormTimeoutMs(Number(e.target.value))}
            />
          </div>

          <div className="p-4 bg-surface rounded-lg border border-surface-border space-y-4">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              Network Fault Configuration
            </h4>

            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Fault Type"
                value={formFaultType}
                onChange={(e) => setFormFaultType(e.target.value as any)}
              >
                <option value="latency">Latency (delay packets)</option>
                <option value="timeout">Timeout (stall & drop)</option>
                <option value="bandwidth">Bandwidth (throttle throughput)</option>
                <option value="reset">Connection Reset (TCP RST)</option>
              </Select>

              <Select
                label="Stream Direction"
                value={formStream}
                onChange={(e) => setFormStream(e.target.value as any)}
              >
                <option value="downstream">Downstream (Target → Client)</option>
                <option value="upstream">Upstream (Client → Target)</option>
              </Select>
            </div>

            {formFaultType === 'latency' && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in">
                <Input
                  label="Added Delay (ms)"
                  type="number"
                  min={0}
                  max={60000}
                  value={formLatencyMs}
                  onChange={(e) => setFormLatencyMs(Number(e.target.value))}
                />
                <Input
                  label="Jitter (± ms)"
                  type="number"
                  min={0}
                  max={30000}
                  value={formJitterMs}
                  onChange={(e) => setFormJitterMs(Number(e.target.value))}
                />
              </div>
            )}

            {formFaultType === 'timeout' && (
              <div className="animate-in fade-in">
                <Input
                  label="Timeout Duration (ms, 0 = indefinite stall)"
                  type="number"
                  min={0}
                  max={60000}
                  value={formTimeoutDuration}
                  onChange={(e) => setFormTimeoutDuration(Number(e.target.value))}
                />
              </div>
            )}

            {formFaultType === 'bandwidth' && (
              <div className="animate-in fade-in">
                <Input
                  label="Maximum Rate (KB/s)"
                  type="number"
                  min={1}
                  max={1000000}
                  value={formBandwidthRate}
                  onChange={(e) => setFormBandwidthRate(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          <Input
            label="Tags (comma-separated)"
            placeholder="smoke, latency, p99"
            value={formTags}
            onChange={(e) => setFormTags(e.target.value)}
          />
        </div>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog
        isOpen={deletingProfile !== null}
        onClose={() => setDeletingProfile(null)}
        title="Delete Profile"
        description="Are you sure you want to delete this profile?"
        confirmLabel="Delete Profile"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        isConfirmLoading={deleteProfile.isPending}
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            You are about to delete <span className="font-semibold text-zinc-100">"{deletingProfile?.name}"</span>.
          </p>
          <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-xs text-amber-300">
            <strong>Note on Historical Integrity:</strong> Past completed runs will remain preserved in the database. However, this action cannot be undone. If any active experiment is currently running against this profile, deletion will be rejected.
          </div>
        </div>
      </Dialog>
    </div>
  );
};
