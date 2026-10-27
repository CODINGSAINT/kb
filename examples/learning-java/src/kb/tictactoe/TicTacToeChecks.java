package kb.tictactoe;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static kb.tictactoe.TicTacToe.*;

/** Mechanism checks use a separate eight-line oracle, not Game's win helper. */
public final class TicTacToeChecks {
    private static int checks;

    public static void main(String[] args) throws Exception {
        invalidMovesChangeNothing();
        snapshotsAreDetached();
        finalSquareWinAndDraw();
        sameVersionRace();
        Set<String> positions = new HashSet<>();
        walk(new ArrayList<>(), positions);
        check(positions.size() == 5478, "all reachable positions visited");
        System.out.printf("PASS: %,d checks; %,d legal positions; invalid moves, snapshots, final-square win/draw and same-version race%n",
            checks, positions.size());
    }

    private static void invalidMovesChangeNothing() {
        Game game = new Game();
        reject(game, new Move(Mark.O, 0, 0, 0), Decision.WRONG_TURN);
        reject(game, new Move(Mark.EMPTY, 0, 0, 0), Decision.INVALID_PLAYER);
        reject(game, new Move(null, 0, 0, 0), Decision.INVALID_PLAYER);
        reject(game, new Move(Mark.X, -1, 0, 0), Decision.OUT_OF_BOUNDS);
        reject(game, new Move(Mark.X, 0, 3, 0), Decision.OUT_OF_BOUNDS);
        reject(game, new Move(Mark.X, 0, 0, 7), Decision.STALE_VERSION);
        accept(game, 0, 0);
        reject(game, new Move(Mark.O, 0, 0, 1), Decision.OCCUPIED);
        reject(game, new Move(Mark.X, 0, 1, 1), Decision.WRONG_TURN);
        accept(game, 1, 0);
        reject(game, new Move(Mark.X, 0, 1, 0), Decision.STALE_VERSION);
        check(new Game().snapshot().version() == 0, "games own independent state");
    }

    private static void snapshotsAreDetached() {
        Game game = new Game();
        Snapshot before = game.snapshot();
        accept(game, 0, 0);
        check(before.cell(0, 0) == Mark.EMPTY, "older snapshot does not change");
        try {
            before.cells().set(0, Mark.O);
            throw new AssertionError("snapshot list was mutable");
        } catch (UnsupportedOperationException expected) {
            checks++;
        }
        List<Mark> callerList = new ArrayList<>(before.cells());
        Snapshot copy = new Snapshot(callerList, Mark.X, Status.IN_PROGRESS, 0);
        callerList.set(0, Mark.O);
        check(copy.cell(0, 0) == Mark.EMPTY, "snapshot constructor copies mutable inputs");
    }

    private static void finalSquareWinAndDraw() {
        Game win = replay(new int[][] {{0,0},{0,1},{0,2},{1,0},{1,1},{1,2},{2,1},{2,0},{2,2}});
        check(win.snapshot().version() == 9 && win.snapshot().status() == Status.X_WON,
            "full board can be a win on the main diagonal");
        reject(win, new Move(Mark.O, 0, 0, 9), Decision.GAME_OVER);

        Game draw = replay(new int[][] {{0,0},{0,1},{0,2},{1,1},{1,0},{1,2},{2,1},{2,0},{2,2}});
        check(draw.snapshot().version() == 9 && draw.snapshot().status() == Status.DRAW,
            "full board with no winning line is a draw");
        reject(draw, new Move(Mark.O, 2, 2, 9), Decision.GAME_OVER);
    }

    private static void sameVersionRace() throws Exception {
        Game game = new Game();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("race start timed out");
                return game.play(new Move(Mark.X, 0, 0, 0));
            });
            var second = pool.submit(() -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("race start timed out");
                return game.play(new Move(Mark.X, 0, 1, 0));
            });
            check(ready.await(5, TimeUnit.SECONDS), "both contenders ready");
            start.countDown();
            Decision a = first.get(5, TimeUnit.SECONDS).decision();
            Decision b = second.get(5, TimeUnit.SECONDS).decision();
            check((a == Decision.ACCEPTED && b == Decision.STALE_VERSION)
                || (b == Decision.ACCEPTED && a == Decision.STALE_VERSION),
                "exactly one request from version 0 is accepted");
            check(game.snapshot().version() == 1 && game.snapshot().nextPlayer() == Mark.O,
                "race places one mark and hands turn to O");
        } finally {
            start.countDown();
        }
    }

    private static void walk(List<int[]> path, Set<String> visited) {
        Game game = replay(path.toArray(int[][]::new));
        Snapshot view = game.snapshot();
        String key = view.cells().toString();
        if (!visited.add(key)) return;
        Status expected = oracle(view.cells());
        check(view.status() == expected, "outcome matches independent line oracle");
        long x = view.cells().stream().filter(mark -> mark == Mark.X).count();
        long o = view.cells().stream().filter(mark -> mark == Mark.O).count();
        check(x == o || x == o + 1, "X/O counts alternate");
        check(view.version() == x + o, "version equals occupied cells");
        Mark expectedTurn = expected != Status.IN_PROGRESS ? Mark.EMPTY : x == o ? Mark.X : Mark.O;
        check(view.nextPlayer() == expectedTurn, "next player agrees with outcome and counts");
        if (expected != Status.IN_PROGRESS) {
            reject(game, new Move(Mark.X, 0, 0, view.version()), Decision.GAME_OVER);
            return;
        }
        for (int cell = 0; cell < SIZE * SIZE; cell++) {
            if (view.cells().get(cell) == Mark.EMPTY) {
                path.add(new int[] {cell / SIZE, cell % SIZE});
                walk(path, visited);
                path.remove(path.size() - 1);
            }
        }
    }

    private static Status oracle(List<Mark> cells) {
        int[][] lines = {{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}};
        for (int[] line : lines) {
            Mark mark = cells.get(line[0]);
            if (mark != Mark.EMPTY && cells.get(line[1]) == mark && cells.get(line[2]) == mark)
                return mark == Mark.X ? Status.X_WON : Status.O_WON;
        }
        return cells.contains(Mark.EMPTY) ? Status.IN_PROGRESS : Status.DRAW;
    }

    private static Game replay(int[][] moves) {
        Game game = new Game();
        for (int[] move : moves) accept(game, move[0], move[1]);
        return game;
    }

    private static void accept(Game game, int row, int col) {
        Snapshot before = game.snapshot();
        MoveResult result = game.play(new Move(before.nextPlayer(), row, col, before.version()));
        check(result.accepted(), "legal move accepted");
    }

    private static void reject(Game game, Move move, Decision reason) {
        Snapshot before = game.snapshot();
        MoveResult result = game.play(move);
        check(result.decision() == reason, "specific rejection: " + reason);
        check(result.snapshot().equals(before) && game.snapshot().equals(before),
            "rejection changes no game state");
    }

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
}
