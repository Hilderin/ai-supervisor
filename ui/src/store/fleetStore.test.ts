import { beforeEach, describe, expect, test } from 'bun:test';
import type { Fleet, FleetRow } from '../types';
import { useFleetStore } from './fleetStore';

const row: FleetRow = {
  id: 'ses_test',
  title: 'test',
  status: 'idle',
  pendingForms: [],
  pendingPermissions: [],
};

const fleet = (at: number, rows: FleetRow[]): Fleet => ({ at, rows, concern: null });

describe('fleetStore.setFleet', () => {
  beforeEach(() => {
    useFleetStore.setState({
      fleet: null,
      placements: {},
      order: {},
      nextRank: 1,
      seenAt: {},
      orderHydrated: false,
      closed: {},
      drafts: {},
      error: null,
    });
  });

  test('un snapshot plus ancien n’écrase pas un plus récent', () => {
    useFleetStore.getState().setFleet(fleet(20, [row]));
    useFleetStore.getState().setFleet(fleet(10, []));
    const s = useFleetStore.getState();
    expect(s.fleet?.at).toBe(20);
    expect(s.fleet?.rows.length).toBe(1);
  });

  test('un snapshot plus récent remplace et place les cartes', () => {
    useFleetStore.getState().setFleet(fleet(20, []));
    useFleetStore.getState().setFleet(fleet(30, [row]));
    const s = useFleetStore.getState();
    expect(s.fleet?.at).toBe(30);
    expect(s.placements.ses_test?.section).toBe('running');
  });

  test('le premier snapshot attribue un rang stable', () => {
    useFleetStore.getState().setFleet(fleet(20, [row, { ...row, id: 'ses_b' }]));
    const s = useFleetStore.getState();
    expect(s.order.ses_test).toBe(1);
    expect(s.order.ses_b).toBe(2);
  });

  test('un tri du daemon qui change ne change pas les rangs', () => {
    useFleetStore.getState().setFleet(fleet(20, [row, { ...row, id: 'ses_b' }]));
    useFleetStore.getState().setFleet(fleet(30, [{ ...row, id: 'ses_b' }, row]));
    const s = useFleetStore.getState();
    expect(s.order.ses_test).toBe(1);
    expect(s.order.ses_b).toBe(2);
  });

  test('une première frame vide ne perd pas l’ordre persisté', () => {
    const now = Date.now();
    useFleetStore.setState({
      fleet: null,
      order: { a: 1, b: 2 },
      nextRank: 3,
      seenAt: { a: now, b: now },
      orderHydrated: false,
    });
    useFleetStore.getState().setFleet(fleet(10, []));
    expect(useFleetStore.getState().order).toEqual({ a: 1, b: 2 });
    expect(useFleetStore.getState().orderHydrated).toBe(false);

    useFleetStore.getState().setFleet(
      fleet(20, [{ ...row, id: 'b' }, { ...row, id: 'a' }]),
    );
    const s = useFleetStore.getState();
    expect(s.orderHydrated).toBe(true);
    expect(s.order.a).toBe(1);
    expect(s.order.b).toBe(2);
  });

  test('une fermeture oublie le rang, une réouverture repart en bas', () => {
    useFleetStore.getState().setFleet(fleet(20, [row, { ...row, id: 'ses_b' }]));
    useFleetStore.getState().closeSession('ses_test', 30);
    expect(useFleetStore.getState().order.ses_test).toBeUndefined();

    // la session rouvre après une activité postérieure à la fermeture
    useFleetStore.getState().setFleet(
      fleet(40, [
        { ...row, id: 'ses_b' },
        { ...row, lastUpdateAt: 35 },
      ]),
    );
    expect(useFleetStore.getState().order.ses_test).toBe(3);
  });
});

describe('fleetStore.forgetClosed', () => {
  beforeEach(() => {
    useFleetStore.setState({
      fleet: null,
      placements: {},
      order: {},
      nextRank: 1,
      seenAt: {},
      orderHydrated: false,
      selected: null,
      closed: {},
      drafts: {},
      error: null,
    });
  });

  test('oublie le marqueur local d’une carte restaurée', () => {
    useFleetStore.getState().setFleet(fleet(10, [row]));
    useFleetStore.getState().closeSession('ses_test', 30);
    expect(useFleetStore.getState().closed.ses_test).toBe(30);
    useFleetStore.getState().forgetClosed('ses_test');
    expect(useFleetStore.getState().closed.ses_test).toBeUndefined();
  });

  test('un identifiant inconnu ne change pas l’état', () => {
    useFleetStore.getState().closeSession('ses_test', 30);
    const before = useFleetStore.getState().closed;
    useFleetStore.getState().forgetClosed('ses_autre');
    expect(useFleetStore.getState().closed).toBe(before);
  });
});

describe('fleetStore : sélection du détail quand la tâche disparaît', () => {
  const a = { ...row, id: 'a' };
  const b = { ...row, id: 'b' };
  const c = { ...row, id: 'c' };

  beforeEach(() => {
    useFleetStore.setState({
      fleet: null,
      placements: {},
      order: {},
      nextRank: 1,
      seenAt: {},
      orderHydrated: false,
      selected: null,
      closed: {},
      drafts: {},
      error: null,
    });
  });

  /** Trois tâches affichées a, b, c ; sélection e. */
  const threeRows = (selected: string) => {
    useFleetStore.getState().setFleet(fleet(10, [a, b, c]));
    useFleetStore.getState().setSelected(selected);
  };

  test('la tâche sélectionnée disparaît de la flotte : la voisine du dessus est retenue', () => {
    threeRows('b');
    useFleetStore.getState().setFleet(fleet(20, [a, c]));
    expect(useFleetStore.getState().selected).toBe('a');
  });

  test('la première tâche disparaît : la voisine du dessous est retenue', () => {
    threeRows('a');
    useFleetStore.getState().setFleet(fleet(20, [b, c]));
    expect(useFleetStore.getState().selected).toBe('b');
  });

  test('la dernière tâche disparaît : la voisine du dessus est retenue', () => {
    threeRows('c');
    useFleetStore.getState().setFleet(fleet(20, [a, b]));
    expect(useFleetStore.getState().selected).toBe('b');
  });

  test('plus aucune tâche : la sélection est vidée', () => {
    threeRows('a');
    useFleetStore.getState().setFleet(fleet(20, []));
    expect(useFleetStore.getState().selected).toBeNull();
  });

  test('aucune tâche sélectionnée : rien ne s’ouvre au démarrage', () => {
    useFleetStore.getState().setFleet(fleet(10, [a, b, c]));
    expect(useFleetStore.getState().selected).toBeNull();
    useFleetStore.getState().setFleet(fleet(20, [a, c]));
    expect(useFleetStore.getState().selected).toBeNull();
  });

  test('la disparition d’une autre tâche ne bouge pas la sélection', () => {
    threeRows('c');
    useFleetStore.getState().setFleet(fleet(20, [a, c]));
    expect(useFleetStore.getState().selected).toBe('c');
  });

  test('une clôture depuis l’interface glisse vers la voisine du dessus', () => {
    threeRows('b');
    useFleetStore.getState().closeSession('b');
    expect(useFleetStore.getState().selected).toBe('a');
  });

  test('une clôture de la première tâche glisse vers la voisine du dessous', () => {
    threeRows('a');
    useFleetStore.getState().closeSession('a');
    expect(useFleetStore.getState().selected).toBe('b');
  });

  test('une clôture des autres tâches laisse la sélection en place', () => {
    threeRows('a');
    useFleetStore.getState().closeSession('c');
    expect(useFleetStore.getState().selected).toBe('a');
  });

  test('la sélection ne s’accroche jamais à une tâche masquée par un filtre', () => {
    // b est déjà fermée : elle sort de la liste affichée avant la sélection
    useFleetStore.getState().setFleet(fleet(10, [a, b, c]));
    useFleetStore.getState().closeSession('b', 15);
    useFleetStore.getState().setSelected('b');
    useFleetStore.getState().setFleet(fleet(20, [a, c]));
    // b n'est pas sur l'écran : aucune voisine connue, donc pas de panneau
    // ouvert sur une carte invisible
    expect(useFleetStore.getState().selected).toBeNull();
  });

  test('une tâche busy clôturée n’est pas retirée : la sélection reste', () => {
    useFleetStore.getState().setFleet(fleet(10, [a, { ...b, busy: 500 }, c]));
    useFleetStore.getState().setSelected('b');
    useFleetStore.getState().closeSession('b', 100);
    expect(useFleetStore.getState().selected).toBe('b');
  });

  test('setFleet et closeSession retiennent la même voisine', () => {
    threeRows('b');
    useFleetStore.getState().setFleet(fleet(20, [a, c]));
    const viaFleet = useFleetStore.getState().selected;

    useFleetStore.setState({ fleet: null, order: {}, nextRank: 1, seenAt: {}, orderHydrated: false, closed: {}, selected: null });
    threeRows('b');
    useFleetStore.getState().closeSession('b');
    const viaClose = useFleetStore.getState().selected;

    expect(viaFleet).toBe('a');
    expect(viaClose).toBe(viaFleet);
  });

  test('la disparition émet directement la voisine, sans sélection nulle intermédiaire', () => {
    threeRows('b');
    const seen: Array<string | null> = [];
    const unsubscribe = useFleetStore.subscribe((s) => seen.push(s.selected));
    useFleetStore.getState().setFleet(fleet(20, [a, c]));
    unsubscribe();
    // un seul état émis, déjà sur la voisine : le panneau n'a aucun frame vide
    expect(seen).toEqual(['a']);
  });

  test('une clôture émet directement la voisine, sans sélection nulle intermédiaire', () => {
    threeRows('b');
    const seen: Array<string | null> = [];
    const unsubscribe = useFleetStore.subscribe((s) => seen.push(s.selected));
    useFleetStore.getState().closeSession('b');
    unsubscribe();
    expect(seen).toEqual(['a']);
  });
});

