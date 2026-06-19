import '@jest/globals';
import User from '@/src/models/User';
import { chatService } from '@/src/services/chat';

describe('chatService', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await User.create({ _id: 'u1', name: 'U1', email: 'u1@e.com', passwordHash: 'x' });
    await User.create({ _id: 'u2', name: 'U2', email: 'u2@e.com', passwordHash: 'x' });
  });

  it('createChannel: creates a group channel with members', async () => {
    const ch = await chatService.createChannel({
      userId: 'u1',
      type: 'group',
      name: 'Team',
      memberIds: ['u2'],
    });
    expect(ch.id).toBeTruthy();
    expect(ch.existing).toBe(false);

    const channels = await chatService.listChannels('u1');
    const created = channels.find((c) => c.id === ch.id);
    expect(created).toBeTruthy();
    expect(created!.members.map((m) => m.id).sort()).toEqual(['u1', 'u2']);
  });

  it('createChannel: reuses an existing direct channel', async () => {
    const first = await chatService.createChannel({
      userId: 'u1',
      type: 'direct',
      memberIds: ['u2'],
    });
    const second = await chatService.createChannel({
      userId: 'u1',
      type: 'direct',
      memberIds: ['u2'],
    });
    expect(second.existing).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('createChannel: missing memberIds → AppError 400', async () => {
    await expect(
      chatService.createChannel({ userId: 'u1', type: 'group', memberIds: [] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('listChannels: only channels the user is in', async () => {
    await chatService.createChannel({ userId: 'u1', type: 'group', name: 'A', memberIds: ['u1'] });
    const u2Channels = await chatService.listChannels('u2');
    expect(u2Channels).toHaveLength(0);
  });
});
