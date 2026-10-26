// BEGIN complete
package kb.tictactoe;

import static kb.tictactoe.TicTacToe.*;

public final class TicTacToeDemo {
    // BEGIN demo
    public static void main(String[] args) {
        Game game = new Game();
        Move[] requests = {
            new Move(Mark.X, 0, 0, 0),
            new Move(Mark.O, 0, 0, 1), // Occupied: O keeps the turn and version stays 1.
            new Move(Mark.O, 1, 0, 1),
            new Move(Mark.X, 0, 1, 2),
            new Move(Mark.O, 1, 1, 3),
            new Move(Mark.X, 0, 2, 4), // X wins before O can complete the next row.
            new Move(Mark.O, 2, 2, 5)  // Rejected: a finished board stays finished.
        };
        for (Move request : requests) {
            MoveResult result = game.play(request);
            Snapshot view = result.snapshot();
            System.out.printf("%s (%d,%d), expected=%d -> %s; version=%d, %s, next=%s%n",
                request.player(), request.row(), request.col(), request.expectedVersion(),
                result.decision(), view.version(), view.status(), view.nextPlayer());
        }
        Snapshot view = game.snapshot();
        for (int row = 0; row < SIZE; row++) {
            for (int col = 0; col < SIZE; col++) {
                System.out.print(view.cell(row, col) == Mark.EMPTY ? ". " : view.cell(row, col) + " ");
            }
            System.out.println();
        }
    }
    // END demo
}
// END complete
