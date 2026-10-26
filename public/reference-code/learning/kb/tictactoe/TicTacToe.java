// BEGIN complete
package kb.tictactoe;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;

/** A single-process, two-player, 3-by-3 game. No I/O or external dependencies. */
public final class TicTacToe {
    private TicTacToe() {}
    public static final int SIZE = 3;

    // BEGIN values
    public enum Mark { EMPTY, X, O }
    public enum Status { IN_PROGRESS, X_WON, O_WON, DRAW }
    public enum Decision {
        ACCEPTED, GAME_OVER, INVALID_PLAYER, STALE_VERSION,
        WRONG_TURN, OUT_OF_BOUNDS, OCCUPIED
    }

    public record Move(Mark player, int row, int col, int expectedVersion) {}

    public record Snapshot(List<Mark> cells, Mark nextPlayer,
                           Status status, int version) {
        public Snapshot {
            cells = List.copyOf(cells);
        }

        public Mark cell(int row, int col) {
            if (!inside(row, col)) throw new IllegalArgumentException("Cell outside board");
            return cells.get(row * SIZE + col);
        }
    }

    public record MoveResult(Decision decision, Snapshot snapshot) {
        public boolean accepted() { return decision == Decision.ACCEPTED; }
    }
    // END values

    // BEGIN game
    public static final class Game {
        private final Board board = new Board();
        private Mark nextPlayer = Mark.X;
        private Status status = Status.IN_PROGRESS;
        private int version;

        public synchronized Snapshot snapshot() {
            return view();
        }

        public synchronized MoveResult play(Move move) {
            Objects.requireNonNull(move, "move");
            if (status != Status.IN_PROGRESS) return result(Decision.GAME_OVER);
            if (move.player() == null || move.player() == Mark.EMPTY)
                return result(Decision.INVALID_PLAYER);
            if (move.expectedVersion() != version) return result(Decision.STALE_VERSION);
            if (move.player() != nextPlayer) return result(Decision.WRONG_TURN);
            if (!inside(move.row(), move.col())) return result(Decision.OUT_OF_BOUNDS);
            if (board.at(move.row(), move.col()) != Mark.EMPTY)
                return result(Decision.OCCUPIED);

            board.place(move.row(), move.col(), move.player());
            version++;
            if (board.winsThrough(move.row(), move.col(), move.player())) {
                status = move.player() == Mark.X ? Status.X_WON : Status.O_WON;
                nextPlayer = Mark.EMPTY;
            } else if (version == SIZE * SIZE) {
                status = Status.DRAW;
                nextPlayer = Mark.EMPTY;
            } else {
                nextPlayer = move.player() == Mark.X ? Mark.O : Mark.X;
            }
            return result(Decision.ACCEPTED);
        }

        private Snapshot view() {
            return new Snapshot(board.copyCells(), nextPlayer, status, version);
        }

        private MoveResult result(Decision decision) {
            return new MoveResult(decision, view());
        }
    }
    // END game

    // BEGIN board
    private static final class Board {
        private final Mark[] cells = new Mark[SIZE * SIZE];

        private Board() { Arrays.fill(cells, Mark.EMPTY); }

        private Mark at(int row, int col) { return cells[row * SIZE + col]; }

        private void place(int row, int col, Mark player) {
            cells[row * SIZE + col] = player;
        }

        private List<Mark> copyCells() {
            return List.copyOf(Arrays.asList(cells));
        }

        private boolean winsThrough(int row, int col, Mark player) {
            return line(row, 0, 0, 1, player)
                || line(0, col, 1, 0, player)
                || (row == col && line(0, 0, 1, 1, player))
                || (row + col == SIZE - 1 && line(0, SIZE - 1, 1, -1, player));
        }

        private boolean line(int row, int col, int dr, int dc, Mark player) {
            for (int i = 0; i < SIZE; i++) {
                if (at(row + i * dr, col + i * dc) != player) return false;
            }
            return true;
        }
    }
    // END board

    // BEGIN bounds
    private static boolean inside(int row, int col) {
        return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
    }
    // END bounds
}
// END complete
