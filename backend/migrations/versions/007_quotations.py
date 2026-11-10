"""Persist commercial proposals independently of the live plan."""
from alembic import op
import sqlalchemy as sa

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('quotations',
        sa.Column('project_id',sa.Integer(),sa.ForeignKey('projects.id'),primary_key=True),
        sa.Column('revision',sa.Integer(),nullable=False),
        sa.Column('content',sa.JSON(),nullable=False))


def downgrade():
    op.drop_table('quotations')
