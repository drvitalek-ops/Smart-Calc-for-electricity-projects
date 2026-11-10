"""Allow quotations to be created without a project."""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('standalone_quotations',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('revision',sa.Integer(),nullable=False),
        sa.Column('content',sa.JSON(),nullable=False),sqlite_autoincrement=True)


def downgrade():
    op.drop_table('standalone_quotations')
