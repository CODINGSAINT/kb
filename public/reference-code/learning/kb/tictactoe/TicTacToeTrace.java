package kb.tictactoe;

import static kb.tictactoe.TicTacToe.*;

/** Writes the guided lab data from the same Java Game used by the checks. */
public final class TicTacToeTrace {
    private record Step(Move move, String explanation) {}
    private record Scenario(String id, String title, String description, Step[] steps) {}

    public static void main(String[] args) {
        Scenario[] scenarios = {
            new Scenario("win", "A row win, with two rejected requests",
                "Watch placement, turn and version change together. An occupied-cell request keeps O's turn; a late request cannot reopen a win.",
                new Step[] {
                    step(Mark.X,0,0,0,"X takes the top-left cell. O now has the turn."),
                    step(Mark.O,0,0,1,"O asks for the occupied cell. The board, version and turn all stay unchanged."),
                    step(Mark.O,1,0,1,"O tries an empty cell using the same version. This move is accepted."),
                    step(Mark.X,0,1,2,"X now has two marks in the top row, but has not won yet."),
                    step(Mark.O,1,1,3,"O also has two in a row. It is X's turn next."),
                    step(Mark.X,0,2,4,"X completes row 0. The result becomes X_WON, with no next player."),
                    step(Mark.O,2,2,5,"Even this empty cell cannot be played after the win. The result is GAME_OVER.")
                }),
            scenario("draw", "A full board with no winner",
                "A draw needs all nine accepted moves and no winning line. Follow every turn, then try the extra request.",
                new int[][] {{0,0},{0,1},{0,2},{1,1},{1,0},{1,2},{2,1},{2,0},{2,2}}),
            scenario("last-win", "The ninth move wins instead of drawing",
                "The last cell fills the board and completes X's main diagonal. Win detection must run before the full-board draw check.",
                new int[][] {{0,0},{0,1},{0,2},{1,0},{1,1},{1,2},{2,1},{2,0},{2,2}})
        };
        StringBuilder json = new StringBuilder("{\"source\":\"kb.tictactoe.TicTacToeTrace\",\"scenarios\":[");
        for (int index = 0; index < scenarios.length; index++) {
            if (index > 0) json.append(',');
            Scenario scenario = scenarios[index];
            json.append("{\"id\":").append(quote(scenario.id()))
                .append(",\"title\":").append(quote(scenario.title()))
                .append(",\"description\":").append(quote(scenario.description()))
                .append(",\"frames\":[");
            Game game = new Game();
            frame(json, null, "START", "A fresh game has nine empty cells. X moves first at version 0.", game.snapshot());
            for (Step step : scenario.steps()) {
                MoveResult result = game.play(step.move());
                json.append(',');
                frame(json, step.move(), result.decision().name(), step.explanation(), result.snapshot());
            }
            json.append("]}");
        }
        System.out.println(json.append("]}"));
    }

    private static Scenario scenario(String id, String title, String description, int[][] cells) {
        Step[] steps = new Step[cells.length + 1];
        for (int i = 0; i < cells.length; i++) {
            Mark player = i % 2 == 0 ? Mark.X : Mark.O;
            String explanation = i == 8
                ? id.equals("draw") ? "The ninth accepted move fills the board. No line wins, so the result is DRAW."
                    : "The ninth accepted move completes X's main diagonal. The result is X_WON, even though the board is full."
                : player + " fills (" + cells[i][0] + "," + cells[i][1] + "). The other player gets the turn.";
            steps[i] = step(player, cells[i][0], cells[i][1], i, explanation);
        }
        steps[cells.length] = step(Mark.O,0,0,cells.length,"A finished game rejects every later move and preserves the final board.");
        return new Scenario(id, title, description, steps);
    }

    private static Step step(Mark player, int row, int col, int version, String explanation) {
        return new Step(new Move(player,row,col,version), explanation);
    }

    private static void frame(StringBuilder json, Move move, String decision, String explanation, Snapshot view) {
        json.append("{\"request\":");
        if (move == null) json.append("null");
        else json.append("{\"player\":").append(quote(move.player().name()))
            .append(",\"row\":").append(move.row()).append(",\"col\":").append(move.col())
            .append(",\"expectedVersion\":").append(move.expectedVersion()).append('}');
        json.append(",\"decision\":").append(quote(decision))
            .append(",\"explanation\":").append(quote(explanation))
            .append(",\"snapshot\":{\"cells\":[");
        for (int i = 0; i < view.cells().size(); i++) {
            if (i > 0) json.append(',');
            json.append(quote(view.cells().get(i).name()));
        }
        json.append("],\"nextPlayer\":").append(quote(view.nextPlayer().name()))
            .append(",\"status\":").append(quote(view.status().name()))
            .append(",\"version\":").append(view.version()).append("}}");
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
